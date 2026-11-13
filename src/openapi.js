'use strict'

const { version } = require('../package.json')
const { DEFAULT_TIMINGS } = require('./calibration')
const { CHANGE_LOG_KINDS } = require('./routes')

const ref = (name) => ({ $ref: '#/components/schemas/' + name })
const string = (description) => ({ type: 'string', ...(description ? { description } : {}) })
const number = (description) => ({ type: 'number', ...(description ? { description } : {}) })
const boolean = (description) => ({ type: 'boolean', ...(description ? { description } : {}) })
const array = (items) => ({ type: 'array', items })
const object = (properties = {}, required = [], additionalProperties = true) => ({
  type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties
})
const nullable = (schema) => ({ ...schema, nullable: true })
const id = () => ({ type: 'string', minLength: 1, description: 'Stored record ID, not necessarily a UUID.' })
const parameter = (name, location, schema, required = true) => ({
  name, in: location, required, schema
})
const pathId = () => parameter('id', 'path', id())
const jsonResponse = (description, schema) => ({
  description, content: { 'application/json': { schema } }
})

// Builds a fresh document: Signal K adds server metadata when serving it.
// Schemas describe supported client inputs; existing handlers remain authoritative.
function getOpenApi () {
  const timingDescriptions = {
    baselineS: 'Seconds recorded for each baseline.',
    settleS: 'Seconds to wait after switching.',
    measureS: 'Seconds measured with the load on.',
    repeats: 'Number of delta measurement cycles.',
    sampleMs: 'Milliseconds between samples.',
    watchS: 'Seconds to observe a watch run.',
    responseS: 'Seconds to wait for switch feedback.',
    silentS: 'Seconds without a fresh meter reading before failure.',
    promptS: 'Seconds to wait for a manual step.'
  }
  const timings = object(Object.fromEntries(Object.entries(DEFAULT_TIMINGS).map(([key, value]) => [
    key, {
      type: key === 'repeats' || key === 'sampleMs' ? 'integer' : 'number',
      minimum: key === 'repeats' || key === 'sampleMs' ? 1 : 0,
      default: value,
      description: timingDescriptions[key]
    }
  ])), [], false)
  const switchFields = {
    state: boolean('Desired on/off state.'),
    confirmed: boolean('Set true only after the user confirms the affected devices when confirmation is required.')
  }
  const schemas = {
    Error: object({
      error: string(), reason: string(), confirmationRequired: boolean(),
      switchDeviceId: string(), switchDeviceName: string(),
      consumerIds: array(string()), consumerNames: array(string())
    }, ['error']),
    Attachment: object({
      id: string(), ownerType: string(), ownerId: string(), filename: string(),
      mimeType: string(), uploadedAt: { type: 'string', format: 'date-time' }
    }, ['id', 'ownerType', 'ownerId', 'filename', 'mimeType', 'uploadedAt']),
    Change: object({
      id: string(), recordType: string(), recordId: string(),
      timestamp: { type: 'string', format: 'date-time' }, summary: string(),
      diff: nullable(object())
    }, ['id', 'recordType', 'recordId', 'timestamp', 'summary', 'diff']),
    Diagram: object({
      circuit: object(),
      nodes: array(object({
        id: string(), label: string(), kind: { type: 'string', enum: ['device', 'label'] }, status: string()
      }, ['id', 'label', 'kind', 'status'])),
      edges: array(object({
        id: string(), from: string(), to: string(),
        kind: { type: 'string', enum: ['feed', 'return'] },
        color: nullable(string()), gauge: nullable(number()), gaugeUnit: nullable(string()), status: string()
      }, ['id', 'from', 'to', 'kind']))
    }, ['circuit', 'nodes', 'edges']),
    Derived: object({
      banks: array(object()), warnings: array(object())
    }, ['banks', 'warnings']),
    Live: object({
      consumers: { type: 'object', additionalProperties: object({
        switchable: boolean(), switchDeviceId: nullable(string()), switchDeviceIds: array(string()),
        sharedWith: array(string()), neverRemote: boolean(), confirm: boolean(),
        reason: nullable(string()), voltage: nullable(number()), meters: array(object())
      }) },
      switches: { type: 'object', additionalProperties: object() },
      batteries: { type: 'object', additionalProperties: object() }
    }, ['consumers', 'switches', 'batteries']),
    SwitchRequest: {
      description: 'Select a consumer or a switch device. When both IDs are supplied, consumerId takes precedence.',
      oneOf: [
        object({ consumerId: id(), deviceId: id(), ...switchFields }, ['consumerId', 'state'], false),
        object({ deviceId: id(), ...switchFields }, ['deviceId', 'state'], false)
      ]
    },
    SwitchResult: object({
      ok: boolean(), pending: boolean('True when Signal K accepted the command but has not confirmed completion.'),
      path: string(), state: boolean(),
      value: { oneOf: [boolean(), number(), string()] },
      switchDeviceId: string(), switchDeviceName: string(),
      consumerIds: array(string()), consumerNames: array(string())
    }, ['ok', 'pending', 'path', 'state', 'value', 'switchDeviceId', 'consumerIds']),
    CalibrationRequest: object({
      deviceId: id(),
      method: { type: 'string', enum: ['delta', 'watch'] },
      hand: boolean('For a delta run, require manual switching even if the device is switchable.'),
      meter: object({
        path: { type: 'string', minLength: 1 },
        unit: { type: 'string', enum: ['A', 'W'] },
        source: string('Meter attribution stored with the run; it does not select a Signal K data source.')
      }, ['path', 'unit'], false),
      voltage: { type: 'number', minimum: 0, exclusiveMinimum: true, description: 'Voltage used to convert amperes to watts. Required for an A meter unless the circuit supplies it.' },
      timings,
      autoContinue: { ...boolean('Continue manual prompts when a meter step is detected.'), default: true },
      thresholdFraction: { ...number('Watch on-threshold as a fraction of peak load; zero falls back to 0.1.'), default: 0.1 },
      confirmed: boolean('Set true only after confirmation of all consumers affected by automatic switching.')
    }, ['deviceId', 'method'], false),
    CalibrationRun: object({
      id: string(), deviceId: string(), switchDeviceId: nullable(string()), consumerIds: nullable(array(string())),
      method: { type: 'string', enum: ['delta', 'watch'] },
      status: { type: 'string', enum: ['running', 'done', 'failed', 'cancelled'] },
      review: { type: 'string', enum: ['pending', 'accepted', 'rejected'] },
      meterPath: nullable(string()), meterUnit: nullable(string()), voltage: nullable(number()), estimate: boolean(),
      startedAt: { type: 'string', format: 'date-time' }, endedAt: nullable({ type: 'string', format: 'date-time' }),
      params: nullable(object()), samples: nullable(array(array(number()))), details: nullable(object()),
      avgW: nullable(number()), peakW: nullable(number()), dutyCycle: nullable(number()),
      confidence: nullable(string()), error: nullable(string())
    }, ['id', 'deviceId', 'method', 'status', 'review', 'estimate', 'startedAt']),
    CalibrationStatus: object({
      state: { type: 'string', enum: ['idle', 'running', 'done', 'failed', 'cancelled'] },
      runId: string(), deviceId: string(), method: string(), phase: string(), message: string(),
      prompt: nullable(object()), live: nullable(object()), cycle: number(), cycles: number(),
      progress: object({ done: number(), total: number() }), startedAt: number('Unix time in milliseconds.'),
      error: nullable(string()), auto: boolean(), autoContinue: boolean()
    }, ['state']),
    Ok: object({ ok: boolean('Whether the requested transition was applicable.') }, ['ok'])
  }
  const paths = {}
  const operation = (method, path, operationId, summary, description, access, options = {}) => {
    const { parameters, body, example, response = object(), status = 200, errors = [], disabled = true } = options
    const responses = {
      [status]: status === 204 ? { description: 'Completed; no response body.' } : jsonResponse('Successful response.', response),
      401: { description: 'Signal K authentication or sufficient native permissions are required.' },
      403: { description: 'The native access level or device safety policy denies the operation.' }
    }
    for (const [code, meaning] of errors) responses[code] = jsonResponse(meaning, ref('Error'))
    if (disabled) responses[503] = jsonResponse('The Wiring plugin is disabled.', ref('Error'))
    const accessDescription = access === 'admin'
      ? 'Requires a Signal K administrator.'
      : 'Requires Signal K ' + access + ' access where router.access is available; older servers require admin.'
    if (!paths[path]) paths[path] = {}
    paths[path][method] = {
      operationId, summary, description: description + ' ' + accessDescription,
      'x-signalk-access': access,
      ...(parameters ? { parameters } : {}),
      ...(body ? { requestBody: {
        required: true,
        content: { 'application/json': { schema: body, ...(example ? { example } : {}) } }
      } } : {}),
      responses
    }
  }
  operation('get', '/version', 'getWiringVersion', 'Get the Wiring version',
    'Returns the installed package version even when the plugin is disabled.', 'readonly', {
      response: object({ version: string() }, ['version']), disabled: false
    })
  operation('get', '/attachments', 'listAttachments', 'List attachment metadata',
    'Lists metadata for one device, cable or conduit. Does not return file bytes.', 'admin', {
      parameters: [
        parameter('ownerType', 'query', { type: 'string', enum: ['device', 'wireRun', 'conduit'] }),
        parameter('ownerId', 'query', id())
      ], response: array(ref('Attachment')), errors: [[400, 'Owner type and ID are required.']]
    })
  operation('delete', '/attachments/{id}', 'deleteAttachment', 'Permanently delete an attachment',
    'Deletes the attachment metadata and its stored file. This is permanent, not a soft removal.', 'admin', {
      parameters: [pathId()], status: 204, errors: [[404, 'Attachment not found.']]
    })
  for (const [collection, singular, condition] of [
    ['cables', 'Cable', 'The cable must already be removed. Its conductors, assignments, diagram links, history and attachments are erased.'],
    ['devices', 'Device', 'The device must already be removed, contain no devices and have no cables ending on it. Its associated records, calibration runs, history and attachments are erased.'],
    ['conduits', 'Conduit', 'The conduit must already be removed. Its cable assignments, history and attachments are erased; cables are retained.'],
    ['schematics', 'Schematic', 'The schematic must already be removed. Its placements, wires, zone shapes and history are erased; physical devices and cables are retained.']
  ]) {
    operation('delete', '/' + collection + '/{id}/purge', 'purge' + singular,
      'Permanently delete a removed ' + singular.toLowerCase(), condition + ' This cannot be undone.', 'admin', {
        parameters: [pathId()], status: 204, errors: [[404, 'Record not found.'], [409, 'The record is not removed or still has blocking relationships.']]
      })
  }
  operation('post', '/zones/{id}/merge', 'mergeZones', 'Merge one zone into another',
    'Moves zone assignments to the target and deletes the source zone. Existing target schematic shapes take precedence. Changes are logged.', 'admin', {
      parameters: [pathId(), parameter('into', 'query', id())],
      response: object({ id: string(), name: string() }, ['id', 'name']),
      errors: [[400, 'Target is missing or a zone is being merged into itself.'], [404, 'Source or target zone not found.']]
    })
  operation('get', '/derived', 'getDerivedWiring', 'Read derived battery banks and warnings',
    'Returns battery banks and warnings that may span circuits, as calculated by the Wiring provider.', 'readonly', { response: ref('Derived') })
  operation('get', '/circuits/{id}/diagram', 'getCircuitDiagram', 'Read circuit diagram data',
    'Returns circuit metadata, device nodes and feed/return cable edges as JSON, not a rendered image.', 'admin', {
      parameters: [pathId()], response: ref('Diagram'), errors: [[404, 'Circuit not found.']]
    })
  operation('get', '/changelog/{kind}/{id}', 'getChangeLog', 'Read a record change log',
    'Returns timestamped change summaries and diffs for the selected record.', 'admin', {
      parameters: [parameter('kind', 'path', { type: 'string', enum: [...CHANGE_LOG_KINDS] }), pathId()],
      response: array(ref('Change')), errors: [[400, 'Unsupported record kind.']]
    })
  operation('get', '/live', 'getLiveWiring', 'Read switchability and meter associations',
    'Returns consumers, switches and battery monitor paths derived from the wiring. This does not switch devices or stream live measurements.', 'readonly', { response: ref('Live') })
  operation('post', '/switch', 'switchDevice', 'Switch a consumer or switch device',
    'Can operate real hardware and affect every consumer sharing the selected switch. Refuses never-remote devices and requires confirmed=true where flagged. A 409 confirmation response identifies affected devices. Success with pending=true means accepted, not confirmed complete. A timeout or failure does not prove that the hardware remained unchanged; do not automatically retry.', 'readwrite', {
      body: ref('SwitchRequest'), example: { deviceId: 'example-relay', state: false },
      response: ref('SwitchResult'),
      errors: [[400, 'A target ID and boolean state are required.'], [403, 'Remote switching is forbidden.'], [404, 'Consumer or switch not found.'], [409, 'No remote switch or confirmation is required.'], [500, 'Unexpected switching failure.'], [502, 'The native command failed.'], [504, 'The command timed out; its physical outcome may be unknown.']]
    })
  operation('post', '/calibration/runs', 'startCalibrationRun', 'Start a load calibration run',
    'Starts one background delta or watch run. Delta mode may switch real hardware unless hand=true; shared switches produce a group result. Safety flags and required confirmation apply to automatic switching. Watch/manual modes prompt the user. Runs continue after the client disconnects; start is not completion and must not be automatically retried. Meter values, timing and restoration remain provider behavior.', 'readwrite', {
      body: ref('CalibrationRequest'), example: { deviceId: 'example-lamp', method: 'watch', meter: { path: 'electrical.batteries.house.power', unit: 'W' } },
      status: 201, response: object({ run: ref('CalibrationRun'), group: boolean() }, ['run', 'group']),
      errors: [[400, 'Invalid method, meter, voltage or device role.'], [403, 'Automatic remote switching is forbidden.'], [404, 'Device not found.'], [409, 'Another run is active or switching needs confirmation.']]
    })
  operation('get', '/calibration/status', 'getCalibrationStatus', 'Read calibration progress',
    'Returns idle, the active run or the latest run status, including prompts and the latest sampled meter value.', 'readonly', { response: ref('CalibrationStatus') })
  operation('get', '/calibration/runs', 'listCalibrationRuns', 'List recorded calibration runs',
    'Lists stored runs newest first, optionally for one device. Group runs are stored against the shared switch device.', 'readonly', {
      parameters: [parameter('deviceId', 'query', id(), false)], response: array(ref('CalibrationRun'))
    })
  operation('post', '/calibration/continue', 'continueCalibration', 'Continue a manual calibration prompt',
    'Signals the active prompt to continue. Returns ok=false when no prompt is waiting; progress is available from calibration/status.', 'readwrite', { response: ref('Ok') })
  operation('post', '/calibration/finish', 'finishCalibration', 'Request early completion of calibration observation',
    'Requests early completion while watching or waiting. Returns before the background run finishes; poll calibration/status. Returns ok=false outside those phases.', 'readwrite', { response: ref('Ok') })
  operation('post', '/calibration/cancel', 'cancelCalibration', 'Cancel the active calibration run',
    'Requests cancellation and waits for the runner to stop. An automatic run may attempt to restore the original switch state. Cancellation does not undo prior hardware actions or guarantee physical restoration. Returns ok=false when idle.', 'readwrite', { response: ref('Ok') })
  operation('post', '/calibration/runs/{id}/recompute', 'recomputeCalibrationRun', 'Recompute a finished watch run',
    'Recalculates a finished watch run from stored samples using a nonnegative on-threshold in the meter unit. Updates stored statistics and details without taking new measurements.', 'readwrite', {
      parameters: [pathId()], body: object({ threshold: { type: 'number', minimum: 0 } }, ['threshold'], false),
      example: { threshold: 2 }, response: ref('CalibrationRun'),
      errors: [[400, 'Threshold is invalid or the run is not a finished watch run.'], [404, 'Run not found.']]
    })
  for (const verdict of ['accept', 'reject']) {
    operation('post', '/calibration/runs/{id}/' + verdict, verdict + 'CalibrationRun',
      (verdict === 'accept' ? 'Accept' : 'Reject') + ' a finished calibration run',
      'Sets the review decision on a completed run and logs it on the device. Accepted runs can supply measured values for load checks; rejecting changes which accepted run is selected. Does not start a measurement or switch hardware.', 'readwrite', {
        parameters: [pathId()], response: ref('CalibrationRun'),
        errors: [[400, 'Only a finished run can be reviewed.'], [404, 'Run not found.']]
      })
  }
  return {
    openapi: '3.0.3',
    info: {
      title: 'Signal K Wiring JSON API', version,
      description: 'JSON and no-content plugin operations. Binary attachment/image transfers and native /signalk/v2/api/resources collections are separate. Discover resources through the native Resources API. Native Signal K authentication and route permissions always apply; OpenAPI discovery grants no permission. Request schemas describe supported inputs and do not replace handler validation.'
    },
    servers: [{ url: '/plugins/signalk-wiring' }],
    security: [{ bearerAuth: [] }],
    paths,
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', description: 'Existing Signal K bearer token. Native admin browser sessions can also authenticate.' } },
      schemas
    }
  }
}

module.exports = { getOpenApi }
