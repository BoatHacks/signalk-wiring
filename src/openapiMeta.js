'use strict'

// The hand-written part of the OpenAPI document (plan 0036): for every
// operation its summary, a plain-English description written for AI
// assistants, parameters, request body, responses and an example. The list of
// operations itself is generated from the registered routes (src/openapi.js);
// this table is keyed by 'METHOD path' with the path as the plugin registers
// it (:id for a parameter) or, for the resource API, the full path.
// test/openapi.test.js fails for a route without an entry and for an entry
// without a route.

const ADVISORY = 'The data is advisory documentation of one boat\'s wiring, kept by its owner. It is not a safety guarantee: check the boat itself and the rules that apply to it before acting on it.'

// Resource types of the SignalK resource API this plugin provides. `write`
// says which writes the provider accepts.
const RESOURCE_TYPES = [
  {
    type: 'wiringDevices', schema: 'Device', noun: 'device', plural: 'devices', write: ['PUT', 'POST', 'DELETE'],
    about: 'Devices: consumers, sources, batteries, fuses and breakers, switches and bus bars, converters and enclosures. A device record also carries its terminals, the latest accepted measurement and, for an enclosure, what it holds.'
  },
  {
    type: 'wiringWireRuns', schema: 'WireRun', noun: 'cable', plural: 'cables (wire runs)', write: ['PUT', 'POST', 'DELETE'],
    about: 'Cables between two devices, with conductors, size, length, route and the conduits they pass through. A cable runs from the supply side (fromDeviceId) to the load side (toDeviceId).'
  },
  {
    type: 'wiringCircuits', schema: 'Circuit', noun: 'circuit', plural: 'circuits', write: ['PUT'],
    about: 'Circuits, worked out by the plugin from the cables: what one fuse or breaker protects. Each record carries a derived block (protecting device, rating, voltage, AC or DC, the devices and cables). Circuits cannot be created or deleted by hand; only name, notes, voltage override, convention and meter can be edited.'
  },
  {
    type: 'wiringConduits', schema: 'Conduit', noun: 'conduit', plural: 'conduits, trunking and trays', write: ['PUT', 'POST', 'DELETE'],
    about: 'Conduits, trunking and cable trays that carry cables.'
  },
  {
    type: 'wiringBackbones', schema: 'Backbone', noun: 'backbone', plural: 'NMEA 2000 backbones', write: ['PUT', 'POST', 'DELETE'],
    about: 'NMEA 2000 backbones. Each record holds the cable class, length, terminators, supply rating and the taps: one per device drop, with the drop length, the place along the backbone and an optional power feed.'
  },
  {
    type: 'wiringZones', schema: 'Zone', noun: 'zone', plural: 'zones (places on the boat)', write: ['PUT', 'POST', 'DELETE'],
    about: 'Named places on the boat. Devices, cables and conduits belong to a zone.'
  },
  {
    type: 'wiringPlans', schema: 'Plan', noun: 'plan', plural: 'plans (drawings of the boat)', write: ['PUT', 'POST', 'DELETE'],
    about: 'Drawings of the boat (deck plan, side view) that devices and cables are placed on. The drawing file is a separate upload.'
  },
  {
    type: 'wiringSchematics', schema: 'Schematic', noun: 'schematic page', plural: 'schematic pages', write: ['PUT', 'POST', 'DELETE'],
    about: 'Diagrams of the electrical system: which devices are on a page and where. Cables show up on a page by themselves.'
  },
  {
    type: 'wiringSettings', schema: 'Settings', noun: 'settings record', plural: 'plugin settings (one record, id "config")', write: [],
    about: 'The plugin settings, such as the voltage drop limits of the cable checks. Read only here; they are changed in the plugin configuration.'
  }
]

const RESOURCE_BASE = '/signalk/v2/api/resources'

const resourceExample = {
  wiringDevices: { id: 'a1b2c3', name: 'Bilge pump', type: 'Bilge pump', role: 'consumer', zone: 'Bilge', ratedPowerW: 60, status: 'active', terminals: [] },
  wiringWireRuns: { id: 'w-12', fromDeviceId: 'a1b2c3', toDeviceId: 'f9e8d7', gauge: 10, gaugeUnit: 'AWG', length: 3.5, lengthUnit: 'm', cableLabel: 'Pump feed', status: 'active', conductors: [{ conductor: 'positive', color: 'red' }], conduitIds: [] },
  wiringCircuits: { id: 'c-4', name: 'Bilge pump circuit', key: 'protector:f9e8d7', status: 'active', cableIds: ['w-12'], derived: { protectorId: 'f9e8d7', ratingA: 10, voltage: 12, ac: false, unprotected: false, endDeviceIds: ['a1b2c3'] } },
  wiringConduits: { id: 'k-1', name: 'Port conduit', kind: 'conduit', innerDiameter: 25, diameterUnit: 'mm', status: 'active', cableIds: ['w-12'] },
  wiringBackbones: { id: 'bb-1', name: 'Main backbone', cableClass: 'mini', length: 12, lengthUnit: 'm', terminatorA: true, terminatorB: true, supplyRatingA: 4, status: 'active', taps: [{ deviceId: 'a1b2c3', port: 'NMEA 2000', dropLength: 0.5, along: 2, powerFeed: false }] },
  wiringZones: { id: 'z-1', name: 'Bilge' },
  wiringPlans: { id: 'p-1', name: 'Deck', view: 'top', status: 'active' },
  wiringSchematics: { id: 's-1', name: '12 V DC', enclosureId: null, status: 'active', devices: [{ deviceId: 'a1b2c3', x: 40, y: 40 }], wires: [], stubs: [], zoneShapes: [], backboneBoxes: [] },
  wiringSettings: { convention: 'freestyle', defaultGaugeUnit: 'AWG', defaultLengthUnit: 'm', autoTheme: false, showFloorplan: true, demoMode: false, voltageDropLimitCritical: 3, voltageDropLimitNormal: 10, dashboardInputs: [{ label: 'Shore', path: 'electrical.shore.power', unit: 'W', voltage: null, voltagePath: null }], dashboardOutputs: [] }
}

const json = (schema, description, example) => ({ description, schema, ...(example !== undefined ? { example } : {}) })
const ref = (name) => ({ $ref: `#/components/schemas/${name}` })
const idParam = (what) => ({ name: 'id', in: 'path', required: true, description: `Id of the ${what}.`, schema: { type: 'string' } })

// The operations of the resource API for every type, as metadata entries.
function resourceMeta () {
  const out = {}
  for (const t of RESOURCE_TYPES) {
    const base = `${RESOURCE_BASE}/${t.type}`
    const one = resourceExample[t.type]
    const tag = 'Resources'
    out[`GET ${base}`] = {
      tag,
      summary: `List ${t.plural}`,
      description: `Returns every ${t.noun} as an object keyed by id. ${t.about} Removed records are included, with status "removed"; skip them unless history matters. ${ADVISORY}`,
      responses: { 200: json({ type: 'object', additionalProperties: ref(t.schema) }, `An object that maps each id to its record.`, t.type === 'wiringSettings' ? { config: one } : { [one.id]: one }) },
      errors: [404]
    }
    out[`GET ${base}/:id`] = {
      tag,
      summary: `Get one ${t.noun}`,
      description: `Returns one ${t.noun} by id${t.type === 'wiringSettings' ? ' (the only id is "config")' : ''}. Answers 404 when there is no such record.`,
      parameters: [idParam(t.noun)],
      responses: { 200: json(ref(t.schema), `The ${t.noun}.`, one) },
      errors: [404]
    }
    if (t.write.includes('POST')) {
      out[`POST ${base}`] = {
        tag,
        summary: `Create a ${t.noun}`,
        description: `Creates a ${t.noun} with a new id chosen by the server. Send only the fields you know; every other field stays empty. Needs the admin login. This changes the owner's documentation, so do it only when asked, and tell the user what you wrote. Everything written is kept in the change log.`,
        requestBody: { required: true, description: `The ${t.noun}, without an id.`, schema: ref(`${t.schema}Input`), example: (({ id, ...rest }) => rest)(one) },
        responses: { 200: json(ref('ResourceWriteResult'), 'The server accepted the write; id is the new record id.', { state: 'COMPLETED', statusCode: 200, id: one.id }) },
        errors: [400]
      }
    }
    if (t.write.includes('PUT')) {
      out[`PUT ${base}/:id`] = {
        tag,
        summary: t.type === 'wiringCircuits' ? 'Edit a circuit' : `Create or update a ${t.noun}`,
        description: t.type === 'wiringCircuits'
          ? 'Edits the editable fields of an existing circuit (name, notes, voltage override, convention, meter). Fields that are not sent stay as they are. A circuit that does not exist cannot be created. Needs the admin login.'
          : `Writes the ${t.noun} with this id: it is created when it does not exist, and otherwise only the fields you send change. Needs the admin login. Marking "status": "removed" removes it from every view but keeps it for history. This changes the owner's documentation, so do it only when asked, and tell the user what you wrote. Everything written is kept in the change log.`,
        parameters: [idParam(t.noun)],
        requestBody: { required: true, description: `The fields to write.`, schema: ref(`${t.schema}Input`), example: t.type === 'wiringCircuits' ? { name: 'Bilge pump circuit', notes: 'Fused at the battery switch.' } : one },
        responses: { 200: json(ref('ResourceWriteResult'), 'The server accepted the write.', { state: 'COMPLETED', statusCode: 200 }) },
        errors: [400, 404]
      }
    }
    if (t.write.includes('DELETE')) {
      out[`DELETE ${base}/:id`] = {
        tag,
        summary: t.type === 'wiringZones' ? 'Delete a zone' : `Remove a ${t.noun}`,
        description: t.type === 'wiringZones'
          ? 'Deletes a zone that nothing uses; a zone in use is refused with 400. Needs the admin login.'
          : `Marks the ${t.noun} as removed. It stays in the database for history and can be restored by writing "status": "active". To erase it for good use the purge operation, where there is one. Needs the admin login.`,
        parameters: [idParam(t.noun)],
        responses: { 200: json(ref('ResourceWriteResult'), 'The server accepted the delete.', { state: 'COMPLETED', statusCode: 200 }) },
        errors: [400, 404]
      }
    }
  }
  return out
}

const purge = (noun, attachments) => ({
  tag: 'Maintenance',
  summary: `Erase a removed ${noun} for good`,
  description: `Permanently erases a ${noun} that is already marked removed, with its change history${attachments ? ' and attached files' : ''}. This cannot be undone and is for the owner to decide: never call it on your own initiative. Answers 404 for an unknown id and 409 when the record is not removed or something still depends on it (the message names what). Needs the admin login.`,
  parameters: [idParam(noun)],
  responses: { 204: { description: 'Erased. No body.' } },
  errors: [404, 409, 503]
})

const META = {
  'GET /version': {
    tag: 'Plugin',
    summary: 'Plugin version',
    description: 'Returns the version of the signalk-wiring plugin. Answers even while the plugin is stopped.',
    responses: { 200: json(ref('Version'), 'The version.', { version: '0.7.4' }) },
    errors: []
  },

  'GET /search': {
    tag: 'Query',
    summary: 'Search devices and cables',
    description: `Finds devices and cables by words in their name, label, type, make and model, tags, zone, SignalK path or notes. Every word must match somewhere; results are ranked (an exact name beats a word start, which beats a fragment) and each says why it matched. Use it first when the user names something ("the bilge pump", "the windlass") and you need its id for other calls. With no text, a zone or role alone lists what is there. At most 25 results by default and never more than 100. ${ADVISORY}`,
    parameters: [
      { name: 'q', in: 'query', description: 'Words to look for, separated by spaces.', schema: { type: 'string' }, example: 'bilge pump' },
      { name: 'kind', in: 'query', description: 'Only devices or only cables.', schema: { type: 'string', enum: ['device', 'cable'] } },
      { name: 'zone', in: 'query', description: 'Only records in the zone with this name (ignoring case).', schema: { type: 'string' } },
      { name: 'role', in: 'query', description: 'Only devices with this role. Cables are left out when set.', schema: { type: 'string', enum: ['consumer', 'source', 'storage', 'distribution', 'converter', 'enclosure'] } },
      { name: 'limit', in: 'query', description: 'How many results to return: 25 when omitted, 100 at most.', schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 } }
    ],
    responses: {
      200: json(ref('SearchResponse'), 'Best matches first.', {
        query: { q: 'bilge pump', kind: null, zone: null, role: null, limit: 25 },
        total: 1,
        results: [{ kind: 'device', id: 'a1b2c3', name: 'Bilge pump', type: 'Bilge pump', role: 'consumer', zone: 'Bilge', score: 100, why: ['name is "Bilge pump"'] }]
      })
    },
    errors: [400, 503]
  },

  'GET /trace/:deviceId': {
    tag: 'Query',
    summary: 'Trace a device toward its supply and its loads',
    description: `Follows the power cables from one device. "up" goes toward the supply (battery, shore power, generator), "down" toward the loads. Devices and cables come in order of distance, with their enclosures. The answer also lists the circuits the device is part of and the fuse or breaker that protects each. Use it to answer "what feeds this?", "what is fed by this fuse?" and "what happens if this breaker trips?". An enclosure stands for what it holds, and loops of cables are handled: each device is listed once and cycle is true. ${ADVISORY}`,
    parameters: [
      { name: 'deviceId', in: 'path', required: true, description: 'Id of the device to start from (see the search operation).', schema: { type: 'string' } },
      { name: 'direction', in: 'query', description: 'Which way to follow the cables. Both when omitted.', schema: { type: 'string', enum: ['up', 'down', 'both'], default: 'both' } }
    ],
    responses: {
      200: json(ref('TraceResponse'), 'The trace.', {
        device: { id: 'a1b2c3', name: 'Bilge pump', type: 'Bilge pump', role: 'consumer', zone: 'Bilge', enclosures: [] },
        direction: 'both',
        up: { devices: [{ id: 'f9e8d7', name: 'Pump breaker', type: 'Breaker', role: 'distribution', depth: 1, enclosures: ['Switch panel'] }], cables: [{ id: 'w-12', name: 'Pump feed', fromDeviceId: 'f9e8d7', toDeviceId: 'a1b2c3', depth: 1, gauge: 10, gaugeUnit: 'AWG', length: 3.5, lengthUnit: 'm' }], cycle: false },
        down: { devices: [], cables: [], cycle: false },
        circuits: [{ id: 'c-4', name: 'Bilge pump circuit', protectorId: 'f9e8d7', protectorName: 'Pump breaker', ratingA: 10, unprotected: false, voltage: 12, ac: false, role: 'ends at this device' }],
        protection: [{ deviceId: 'f9e8d7', name: 'Pump breaker', ratingA: 10, circuitIds: ['c-4'] }],
        unprotected: false
      })
    },
    errors: [400, 404, 503]
  },

  'GET /load-summary': {
    tag: 'Query',
    summary: 'Load summary of every circuit, with warnings',
    description: `The numbers of the Load Summary tab: for each active circuit the summed power of the consumers it feeds, the current at the circuit voltage, the rating of the protecting fuse or breaker and a status ("over-rating", "incomplete" when a voltage or rating is missing, or "ok"), plus the warnings of the derivation and the one-line summary of the cable checks. Peaks are summed as if all happened at once, which is cautious; a device fed by two circuits counts on both. ${ADVISORY}`,
    responses: {
      200: json(ref('LoadSummaryResponse'), 'One row per circuit.', {
        note: 'A device fed by more than one circuit has its full wattage counted on each, which can overstate the load of a backup path. Advisory, not a certified calculation.',
        circuits: [{ id: 'c-4', name: 'Bilge pump circuit', status: 'ok', incompleteReason: null, load: { deviceCount: 1, unknownWattageCount: 0, totalWatts: 60, averageWatts: 60, measuredCount: 0, estimateCount: 0, groupCount: 0, source: 'rated', amps: 5, overRating: false, missingVoltage: false, missingRating: false, voltage: 12, ratingA: 10, ac: false }}],
        counts: { ok: 1, incomplete: 0, 'over-rating': 0 },
        cableCheckSummary: 'Cable checks (advisory): 1 ok.',
        warnings: []
      })
    },
    errors: [503]
  },

  'GET /checks': {
    tag: 'Query',
    summary: 'Cable checks: is each cable big enough',
    description: `For every cable that carries power: is it big enough for the fuse or breaker that protects it and for its load (ampacity with a derating for bundled conductors), and is the voltage drop along it acceptable, against the limits in the plugin settings. Each result has a verdict ("ok", "warning" for a high voltage drop, "fail" for a cable too small, "cannot" when something needed is missing, with what is missing) and the reasoning with the source of every number. Signal-only cables are not checked. ${ADVISORY}`,
    responses: {
      200: json(ref('ChecksResponse'), 'The results and the counts.', {
        limits: { critical: 3, normal: 10 },
        advisory: 'Advisory only. This is not a safety guarantee: check the cable against the maker\'s data and the rules that apply to your boat.',
        counts: { ok: 1, warning: 0, fail: 0, cannot: 0 },
        results: [{ cableId: 'w-12', name: 'Pump feed', fromDeviceId: 'f9e8d7', toDeviceId: 'a1b2c3', verdict: 'ok', result: { verdict: 'ok' }, explanation: { sections: [{ heading: 'Cable size', verdict: 'ok', lines: ['Table figure 40 A (our table, copper, 105 C insulation, 30 C ambient).'] }], assumptions: ['Each cable is checked alone, its return taken as the same size and length.'], note: 'Advisory only.', circuits: [] } }]
      })
    },
    errors: [503]
  },

  'GET /buses': {
    tag: 'Query',
    summary: 'NMEA 2000 buses with derived data and checks',
    description: `Every live NMEA 2000 backbone with what is worked out from it (devices, backbone length, total and longest drop, device count, terminators, LEN total and the current it implies, the power feed and the circuit it joins) and the advisory checks: backbone length for its cable class, each drop, all drops together, device count, terminators, bus load against the supply rating and a power feed. A check is "ok", "warning" (close to a limit), "fail" or "cannot" (something needed is missing, named in "missing"). Each check lists its numbers, reasoning and the manufacturers' guides it comes from. The load of a bus is added to the circuit its power feed joins (see circuit load, "fromBus"). ${ADVISORY}`,
    responses: {
      200: json(ref('BusesResponse'), 'The buses and the counts.', {
        advisory: 'Advisory, not a guarantee.',
        counts: { ok: 0, warning: 0, fail: 1, cannot: 0 },
        buses: [{
          id: 'bb-1', name: 'Main backbone', verdict: 'fail',
          derived: { backboneId: 'bb-1', name: 'Main backbone', cableClass: 'mini', lengthM: 12, lengthUnit: 'm', supplyRatingA: 4, taps: [], deviceIds: [], deviceCount: 0, totalDropM: 0, longestDropM: null, dropsMissing: [], terminatorCount: 1, lenTotal: null, lenUnknownDeviceIds: [], impliedCurrentA: null, powerFeed: null, circuit: null },
          checks: [{ id: 'terminators', title: 'Terminators', verdict: 'fail', used: { terminatorCount: 1, required: 2 }, missing: [], reasoning: ['1 terminator marked, 2 needed, one at each end.'], sources: [{ id: 'digitalyacht-guide', publisher: 'Digital Yacht', title: 'NMEA 2000 Networking Guide', url: 'https://digitalyacht.net/nmea-2000-networking-guide/', says: 'two terminators' }] }],
          assumptions: ['1 LEN is 50 mA; a device without a LEN counts as unknown.'],
          note: 'Advisory, not a guarantee.'
        }]
      })
    },
    errors: [503]
  },

  'GET /derived': {
    tag: 'Derived data',
    summary: 'Battery banks and wiring warnings',
    description: `The derived data that belongs to no single circuit: the battery banks (layout such as 2S1P, voltage, capacity, energy, what protects them) and all warnings found in the wiring (a cable to a missing device, a converter terminal that is not named, and similar). Circuits are in the wiringCircuits resource. ${ADVISORY}`,
    responses: { 200: json(ref('Derived'), 'Banks and warnings.', { banks: [], warnings: [{ code: 'missing-device', cableId: 'w-9', message: 'Cable w-9 goes to a device that does not exist or has been removed.' }] }) },
    errors: [503]
  },

  'GET /circuits/:id/diagram': {
    tag: 'Derived data',
    summary: 'The devices and cables of one circuit as a graph',
    description: 'Returns the devices (nodes) and cables (edges) of a circuit. A feed edge is on the supply side, a return edge is the negative cable that serves the circuit. Use it to describe the shape of one circuit.',
    parameters: [idParam('circuit')],
    responses: { 200: json(ref('CircuitDiagram'), 'The graph.', { circuit: resourceExample.wiringCircuits, nodes: [{ id: 'a1b2c3', label: 'Bilge pump', kind: 'device', status: 'active' }], edges: [{ id: 'w-12', from: 'f9e8d7', to: 'a1b2c3', kind: 'feed', color: 'red', gauge: 10, gaugeUnit: 'AWG', status: 'active' }] }) },
    errors: [404, 503]
  },

  'GET /live': {
    tag: 'Derived data',
    summary: 'Which consumers can be switched, and which meters measure them',
    description: 'Describes, for every consumer, whether a switch with a SignalK switch path sits between it and its supply, which one, the never-remote and confirm flags, the voltage and the meters that measure it; and the switches and the battery paths. This is a description only: this API cannot switch anything and has no operation for it.',
    responses: { 200: json(ref('Switching'), 'The switching and metering table.', { consumers: {}, switches: {}, batteries: {} }) },
    errors: [503]
  },

  'GET /changelog': {
    tag: 'Change log',
    summary: 'The change log across all records',
    description: 'Every change to the documentation, grouped by record, newest group first. Use it to answer "what changed recently?" or "who touched this device?". Filter by record kind, a time range, a text or one record id; page with cursor.',
    parameters: [
      { name: 'kind', in: 'query', description: 'Record kinds to include, repeated or comma separated.', schema: { type: 'string' }, example: 'device,wireRun' },
      { name: 'since', in: 'query', description: 'Only changes at or after this ISO 8601 time.', schema: { type: 'string', format: 'date-time' } },
      { name: 'until', in: 'query', description: 'Only changes before this ISO 8601 time.', schema: { type: 'string', format: 'date-time' } },
      { name: 'q', in: 'query', description: 'Text to look for in the record name and the change summaries.', schema: { type: 'string' } },
      { name: 'id', in: 'query', description: 'Only this record.', schema: { type: 'string' } },
      { name: 'limit', in: 'query', description: 'Groups per page: 20 when omitted, 100 at most.', schema: { type: 'integer', default: 20, maximum: 100 } },
      { name: 'cursor', in: 'query', description: 'The nextCursor of the previous page.', schema: { type: 'string' } },
      { name: 'entries', in: 'query', description: 'Entries per group: 5 when omitted, 1000 at most.', schema: { type: 'integer', default: 5, maximum: 1000 } }
    ],
    responses: { 200: json(ref('ChangeLogPage'), 'A page of groups.', { groups: [{ kind: 'device', id: 'a1b2c3', name: 'Bilge pump', status: 'active', latest: '2026-11-12T16:45:00.000Z', units: {}, entries: [{ seq: 21, id: 'e-1', recordType: 'device', recordId: 'a1b2c3', timestamp: '2026-11-12T16:45:00.000Z', summary: 'updated', diff: { rated_power_w: { before: 55, after: 60 } } }], more: 0 }], nextCursor: null }) },
    errors: [400, 503]
  },

  'GET /changelog/:kind/:id': {
    tag: 'Change log',
    summary: 'The change log of one record',
    description: 'All changes of one record, oldest first, each with the fields that changed (before and after).',
    parameters: [
      { name: 'kind', in: 'path', required: true, description: 'Kind of record.', schema: { type: 'string', enum: ['circuit', 'wireRun', 'device', 'plan', 'zone', 'conduit', 'schematic', 'backbone'] } },
      idParam('record')
    ],
    responses: { 200: json({ type: 'array', items: ref('ChangeEntry') }, 'The entries.', []) },
    errors: [400, 503]
  },

  'GET /attachments': {
    tag: 'Attachments',
    summary: 'List the files attached to a record',
    description: 'Lists the photos and documents attached to one cable, device or conduit. The files themselves come from the download operation.',
    parameters: [
      { name: 'ownerType', in: 'query', required: true, description: 'Kind of owner.', schema: { type: 'string', enum: ['wireRun', 'device', 'conduit', 'backbone'] } },
      { name: 'ownerId', in: 'query', required: true, description: 'Id of the owner.', schema: { type: 'string' } }
    ],
    responses: { 200: json({ type: 'array', items: ref('Attachment') }, 'The attachments.', [{ id: 'at-1', ownerType: 'device', ownerId: 'a1b2c3', filename: 'pump.jpg', mimeType: 'image/jpeg', uploadedAt: '2026-11-01T10:00:00.000Z' }]) },
    errors: [400, 503]
  },

  'GET /attachments/:id': {
    tag: 'Attachments',
    summary: 'Download an attached file',
    description: 'Returns the file itself (a photo or a PDF) with its own content type.',
    parameters: [idParam('attachment')],
    responses: { 200: { description: 'The file.', content: { 'image/jpeg': { schema: { type: 'string', format: 'binary' } }, 'image/png': { schema: { type: 'string', format: 'binary' } }, 'image/webp': { schema: { type: 'string', format: 'binary' } }, 'image/heic': { schema: { type: 'string', format: 'binary' } }, 'application/pdf': { schema: { type: 'string', format: 'binary' } } } } },
    errors: [404, 503]
  },

  'POST /attachments': {
    tag: 'Attachments',
    summary: 'Attach a file to a record',
    description: 'Uploads a photo (JPEG, PNG, WebP or HEIC) or a PDF, up to 15 MB, and attaches it to a cable, device or conduit. The request body is the raw file and its content type must be the file type. Needs the admin login. Only do this when the user gives you a file to attach.',
    parameters: [
      { name: 'ownerType', in: 'query', required: true, description: 'Kind of owner.', schema: { type: 'string', enum: ['wireRun', 'device', 'conduit', 'backbone'] } },
      { name: 'ownerId', in: 'query', required: true, description: 'Id of the owner.', schema: { type: 'string' } },
      { name: 'filename', in: 'query', required: true, description: 'Name of the file.', schema: { type: 'string' } }
    ],
    requestBody: { required: true, description: 'The raw bytes of the file.', content: { 'image/jpeg': { schema: { type: 'string', format: 'binary' } }, 'image/png': { schema: { type: 'string', format: 'binary' } }, 'image/webp': { schema: { type: 'string', format: 'binary' } }, 'image/heic': { schema: { type: 'string', format: 'binary' } }, 'application/pdf': { schema: { type: 'string', format: 'binary' } } } },
    responses: { 201: json(ref('Attachment'), 'The new attachment.') },
    errors: [400, 413, 415, 503]
  },

  'DELETE /attachments/:id': {
    tag: 'Attachments',
    summary: 'Delete an attached file',
    description: 'Deletes the attachment and its file for good. If it was a device icon, the icon is cleared. Needs the admin login.',
    parameters: [idParam('attachment')],
    responses: { 204: { description: 'Deleted. No body.' } },
    errors: [404, 503]
  },

  'GET /plans/:id/image': {
    tag: 'Plans',
    summary: 'The drawing of a plan',
    description: 'Returns the uploaded drawing of a plan (SVG, PNG, JPEG or WebP). Answers 404 when no drawing was uploaded.',
    parameters: [idParam('plan')],
    responses: { 200: { description: 'The drawing.', content: { 'image/svg+xml': { schema: { type: 'string' } }, 'image/png': { schema: { type: 'string', format: 'binary' } }, 'image/jpeg': { schema: { type: 'string', format: 'binary' } }, 'image/webp': { schema: { type: 'string', format: 'binary' } } } } },
    errors: [404, 503]
  },

  'POST /plans/:id/image': {
    tag: 'Plans',
    summary: 'Upload the drawing of a plan',
    description: 'Uploads the drawing of a plan as the raw file: SVG, PNG, JPEG or WebP, up to 15 MB, checked against its own bytes. It replaces an earlier drawing. Needs the admin login. Only do this when the user gives you a drawing.',
    parameters: [idParam('plan')],
    requestBody: { required: true, description: 'The raw bytes of the drawing.', content: { 'image/svg+xml': { schema: { type: 'string' } }, 'image/png': { schema: { type: 'string', format: 'binary' } }, 'image/jpeg': { schema: { type: 'string', format: 'binary' } }, 'image/webp': { schema: { type: 'string', format: 'binary' } } } },
    responses: { 201: json(ref('Plan'), 'The updated plan.') },
    errors: [400, 404, 413, 415, 503]
  },

  'GET /devices/:id/icon': {
    tag: 'Devices',
    summary: 'The icon of a device',
    description: 'Returns the image set as the icon of a device. Answers 404 when it has none.',
    parameters: [idParam('device')],
    responses: { 200: { description: 'The icon image.', content: { 'image/jpeg': { schema: { type: 'string', format: 'binary' } }, 'image/png': { schema: { type: 'string', format: 'binary' } }, 'image/webp': { schema: { type: 'string', format: 'binary' } }, 'image/heic': { schema: { type: 'string', format: 'binary' } } } } },
    errors: [404, 503]
  },

  'POST /zones/:id/merge': {
    tag: 'Maintenance',
    summary: 'Merge a zone into another',
    description: 'Moves every device, cable and conduit of this zone to the target zone and removes this zone. Needs the admin login. This cannot be undone with one call; do it only when asked.',
    parameters: [idParam('zone to merge away'), { name: 'into', in: 'query', required: true, description: 'Id of the zone that takes over.', schema: { type: 'string' } }],
    responses: { 200: json(ref('Zone'), 'The target zone.', resourceExample.wiringZones) },
    errors: [400, 404, 503]
  },

  'DELETE /cables/:id/purge': purge('cable', true),
  'DELETE /devices/:id/purge': purge('device', true),
  'DELETE /conduits/:id/purge': purge('conduit', true),
  'DELETE /backbones/:id/purge': purge('backbone', true),
  'DELETE /schematics/:id/purge': purge('schematic page', false),

  ...resourceMeta()
}

module.exports = { META, RESOURCE_TYPES, RESOURCE_BASE, ADVISORY }
