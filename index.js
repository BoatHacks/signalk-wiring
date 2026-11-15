'use strict'

const path = require('path')
const { Store } = require('./src/store')
const { createResourceProvider } = require('./src/resources')
const { isDemoMode } = require('./src/demoMode')
const { updateDemoFiles } = require('./src/demoSource')
const { restoreDemoData } = require('./src/demoRestore')
const { resolveSettings, settingsWarnings, createSettingsProvider } = require('./src/settings')
const { registerRoutes } = require('./src/routes')
const { registerLiveRoutes } = require('./src/liveRoutes')
const { getOpenApi } = require('./src/openapi')
const { version: PLUGIN_VERSION } = require('./package.json')

// The admin UI form for one Dashboard source list.
function dashboardList (title, description) {
  return {
    type: 'array',
    title,
    description,
    maxItems: 12,
    items: {
      type: 'object',
      required: ['label', 'path', 'unit'],
      properties: {
        label: { type: 'string', title: 'Label', minLength: 1, maxLength: 40 },
        path: { type: 'string', title: 'SignalK path', description: 'For example electrical.solar.power' },
        unit: { type: 'string', title: 'Unit', enum: ['W', 'A'], enumNames: ['Watts', 'Amps'], default: 'W' },
        voltage: { type: 'number', title: 'Voltage (amps only)', description: 'Fixed voltage that turns amps into watts. 1 to 100.', minimum: 1, maximum: 100 },
        voltagePath: { type: 'string', title: 'Voltage path (amps only)', description: 'A SignalK voltage reading used instead of a fixed voltage.' }
      }
    }
  }
}

module.exports = function (app, deps = {}) {
  const plugin = {}

  plugin.id = 'signalk-wiring'
  plugin.name = 'Wiring Documentation'
  plugin.description =
    "Documents the boat's physical electrical wiring: circuits, wire runs, and devices."

  plugin.schema = {
    type: 'object',
    properties: {
      convention: {
        type: 'string',
        title: 'Wiring convention',
        description: 'Drives labeling hints in the UI only; never enforced on the data.',
        enum: ['freestyle', 'abyc-e11', 'din-en-iso-13297'],
        enumNames: ['Freestyle / none', 'ABYC E-11', 'DIN EN ISO 13297'],
        default: 'freestyle'
      },
      defaultGaugeUnit: {
        type: 'string',
        title: 'Default gauge unit',
        description: 'Pre-selected on new wire run forms; overridable per record.',
        enum: ['AWG', 'mm2'],
        enumNames: ['AWG', 'mm²'],
        default: 'AWG'
      },
      defaultLengthUnit: {
        type: 'string',
        title: 'Default length unit',
        description: 'Pre-selected on new wire run forms; overridable per record.',
        enum: ['m', 'ft'],
        enumNames: ['Meters', 'Feet'],
        default: 'm'
      },
      autoTheme: {
        type: 'boolean',
        title: 'Switch light/dark theme automatically',
        description: 'The webapp follows vessels.self.environment.sun (day, dawn, sunrise, sunset, dusk, night) or, failing that, environment.mode (day or night) instead of the manual toggle. Needs a plugin that publishes one of those paths.',
        default: false
      },
      voltageDropLimitCritical: {
        type: 'number',
        title: 'Voltage drop limit, critical loads (%)',
        description: 'The cable checks warn when a cable drops more than this share of the circuit voltage on a circuit that has a critical device (bilge pump, refrigerator, autopilot, navigation light, windlass). Advisory only. 0.5 to 20.',
        minimum: 0.5,
        maximum: 20,
        default: 3
      },
      voltageDropLimitNormal: {
        type: 'number',
        title: 'Voltage drop limit, other loads (%)',
        description: 'The cable checks warn when a cable drops more than this share of the circuit voltage on any other circuit. Advisory only. 0.5 to 20.',
        minimum: 0.5,
        maximum: 20,
        default: 10
      },
      dashboardInputs: dashboardList('Dashboard inputs', 'Where the Dashboard reads live power in (Shore, Solar, Alternator ...), in the order shown. A filled list replaces the automatic rule that uses the device paths. Up to 12.'),
      dashboardOutputs: dashboardList('Dashboard outputs', 'Where the Dashboard reads live power out (Total load, Inverter ...), in the order shown. A filled list replaces the automatic rule that uses the device paths. Up to 12.')
    }
  }

  let store = null
  let live = null
  let settings = resolveSettings({})

  // Counts starts and stops. A start that has to prepare the demo first only
  // carries on when no stop or newer start came in meanwhile.
  let generation = 0
  // The preparation of the previous start, so two never touch the files at once.
  let preparing = Promise.resolve()

  const report = (message) => {
    if (typeof app.setPluginStatus === 'function') app.setPluginStatus(message)
  }

  // The normal start: open the store and register the resource providers.
  // demoStatus is the demo mode report, or null outside demo mode.
  function begin (options, demo, demoStatus) {
    settings = resolveSettings(options, demo)
    const dropped = settingsWarnings(options)
    const messages = []
    if (dropped.length) messages.push(`Ignored Dashboard entries: ${dropped.join('; ')}`)
    if (demoStatus) messages.push(demoStatus)
    if (messages.length) report(messages.join('. '))
    const dbPath = path.join(app.getDataDirPath(), 'wiring.db')
    store = new Store(dbPath)
    store.abandonRunningRuns()

    const providers = [
      createResourceProvider(store, 'circuit', 'wiringCircuits'),
      createResourceProvider(store, 'wireRun', 'wiringWireRuns'),
      createResourceProvider(store, 'device', 'wiringDevices'),
      createResourceProvider(store, 'plan', 'wiringPlans'),
      createResourceProvider(store, 'zone', 'wiringZones'),
      createResourceProvider(store, 'conduit', 'wiringConduits'),
      createResourceProvider(store, 'schematic', 'wiringSchematics'),
      createResourceProvider(store, 'backbone', 'wiringBackbones'),
      createSettingsProvider(settings)
    ]
    for (const provider of providers) {
      app.registerResourceProvider(provider)
    }
  }

  // Demo mode: bring the demo files up to date, then reset the data to them.
  // Resolves to the status line, or null when this start was cancelled. It does
  // not throw: whatever goes wrong is reported and the plugin starts anyway.
  async function prepareDemo (dataDir, gen) {
    await preparing.catch(() => {})
    if (gen !== generation) return null
    const parts = ['Demo mode on']
    let update
    try {
      update = await updateDemoFiles(dataDir, { fetch: deps.fetch })
    } catch (e) {
      update = { status: 'kept', version: null, reason: `the update failed (${e && e.message})` }
    }
    if (gen !== generation) return null
    const short = update.version ? update.version.slice(0, 7) : null
    if (update.status === 'updated') parts.push(`demo files updated to version ${short}`)
    else if (update.status === 'unchanged') parts.push(`demo files unchanged (version ${short})`)
    else if (short) parts.push(`demo files kept at version ${short} (${update.reason})`)
    else parts.push(`no demo files (${update.reason})`)
    try {
      const restored = restoreDemoData(dataDir)
      if (restored.restored) parts.push(restored.backedUp ? 'data restored from the demo, previous database kept as wiring.db.before-demo' : 'data restored from the demo')
      else parts.push('no demo database, started with the current data')
    } catch (e) {
      parts.push(`data could not be restored (${e && e.message}), started with the current data`)
    }
    return parts.join(', ')
  }

  plugin.start = function (options) {
    const gen = ++generation
    const dataDir = app.getDataDirPath()
    const demo = isDemoMode(dataDir)
    if (!demo) {
      begin(options, false, null)
      return
    }
    // The server does not wait for start(), so the preparation runs on its own.
    // Until it is done the routes answer as when the plugin is disabled.
    report('Preparing the demo')
    preparing = prepareDemo(dataDir, gen).then((demoStatus) => {
      if (demoStatus === null || gen !== generation) return
      begin(options, true, demoStatus)
    }).catch((e) => {
      if (gen !== generation) return
      const message = `Demo mode could not start: ${e && e.message}`
      if (typeof app.setPluginError === 'function') app.setPluginError(message)
      else report(message)
    })
  }

  plugin.stop = function () {
    generation++
    // A run in progress is cancelled first: it writes to the store as it stops.
    const stopping = live ? live.stopRuns().catch(() => {}) : Promise.resolve()
    const closing = store
    store = null
    if (closing) stopping.then(() => closing.close())
  }

  // Called once at server boot for every installed plugin regardless of
  // enabled state (signalk-plugin skill §2), so routes.js reads `store`
  // through this getter rather than a captured value.
  plugin.registerWithRouter = function (router) {
    registerRoutes(router, () => store, app.getDataDirPath(), () => settings)
    live = registerLiveRoutes(router, () => store, { app })
  }

  // The API description (plan 0036). A plugin that registers routes and exports
  // this has its document published by the server at
  // /skServer/openapi/plugins/signalk-wiring; the server calls it once when the
  // plugin is loaded, whether or not it is enabled.
  plugin.getOpenApi = function () {
    return getOpenApi(PLUGIN_VERSION)
  }

  return plugin
}
