import test from 'node:test'
import assert from 'node:assert/strict'
import { CONNECTOR_KINDS, connectorOptions, cleanConnector, describeConnector, hasConnectorExtras } from '../public/connectors.js'
import { cleanTerminals, describeTerminal } from '../public/deviceFields.js'
import { terminalLabel } from '../public/cableForm.js'

test('connectorOptions adds used and current kinds once, without case repeats', () => {
  const o = connectorOptions(['rj45', 'Weird plug', 'weird PLUG', ''], 'Odd thing')
  assert.deepEqual(o.used, ['Odd thing', 'Weird plug'])
  assert.deepEqual(o.terminal, CONNECTOR_KINDS.terminal)
})

test('cleanConnector trims, nulls and validates', () => {
  assert.deepEqual(cleanConnector({ connector: ' RJ45 ', size: '', gender: 'socket', pins: '8' }),
    { connector: 'RJ45', size: null, gender: 'socket', pins: 8 })
  assert.deepEqual(cleanConnector({ gender: 'both', pins: '0' }), { connector: null, size: null, gender: null, pins: null })
  assert.equal(cleanConnector({ pins: 1.5 }).pins, null)
  assert.deepEqual(cleanConnector(undefined), { connector: null, size: null, gender: null, pins: null })
})

test('describeConnector builds a compact line', () => {
  assert.equal(describeConnector({}), '')
  assert.equal(describeConnector({ connector: 'M8 stud' }), 'M8 stud')
  assert.equal(describeConnector({ connector: 'Ferrule', size: '1.5 mm2' }), 'Ferrule 1.5 mm2')
  assert.equal(describeConnector({ connector: 'M8 stud', size: 'M8' }), 'M8 stud')
  assert.equal(describeConnector({ connector: 'RJ45', gender: 'socket', pins: 8 }), 'RJ45 socket 8 pins')
  assert.equal(describeConnector({ pins: 1 }), '1 pin')
})

test('hasConnectorExtras is true only for gender or pins', () => {
  assert.equal(hasConnectorExtras({ connector: 'RJ45' }), false)
  assert.equal(hasConnectorExtras({ gender: 'plug' }), true)
})

test('terminals carry the connector through cleaning and description', () => {
  const [t] = cleanTerminals([{ name: 'B+', conductor: 'positive', connector: 'M8 stud', size: '', gender: '', pins: '' }])
  assert.equal(t.connector, 'M8 stud')
  assert.equal(t.size, null)
  assert.equal(describeTerminal(t), 'B+, positive, M8 stud')
})

test('terminalLabel includes port and connector', () => {
  assert.equal(terminalLabel({ name: 'B+' }), 'B+')
  assert.equal(terminalLabel({ name: 'B+', connector: 'M8 stud' }), 'B+ (M8 stud)')
  assert.equal(terminalLabel({ name: 'DC in +', port: 'DC in', connector: 'Ferrule' }), 'DC in + (DC in, Ferrule)')
})
