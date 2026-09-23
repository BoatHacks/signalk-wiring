'use strict'

const path = require('path')
const { Store } = require('./src/store')
const { createResourceProvider } = require('./src/resources')
const { registerRoutes } = require('./src/routes')

module.exports = function (app) {
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
      }
    }
  }

  let store = null

  plugin.start = function (options) {
    const dbPath = path.join(app.getDataDirPath(), 'wiring.db')
    store = new Store(dbPath)

    const providers = [
      createResourceProvider(store, 'circuit', 'wiringCircuits'),
      createResourceProvider(store, 'wireRun', 'wiringWireRuns'),
      createResourceProvider(store, 'device', 'wiringDevices')
    ]
    for (const provider of providers) {
      app.registerResourceProvider(provider)
    }
  }

  plugin.stop = function () {
    if (store) {
      store.close()
      store = null
    }
  }

  // Called once at server boot for every installed plugin regardless of
  // enabled state (signalk-plugin skill §2), so routes.js reads `store`
  // through this getter rather than a captured value.
  plugin.registerWithRouter = function (router) {
    registerRoutes(router, () => store, app.getDataDirPath())
  }

  return plugin
}
