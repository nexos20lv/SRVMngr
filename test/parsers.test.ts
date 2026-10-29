import assert from 'node:assert/strict'
import test from 'node:test'
import { parseContainers, parseServices } from '../src/main/parsers'
import { parseMetrics } from '../src/main/metrics'
import { shQuote } from '../src/main/shell'
import { parseSiteConfigs } from '../src/main/sites'

test('quotes POSIX shell values safely', () => {
  assert.equal(shQuote("a'b"), "'a'\\''b'")
})

test('parses metrics sections and CPU deltas', () => {
  const sample = [
    '@@host', 'srv',
    '@@stat', 'cpu 200 0 50 750 0 0 0 0 0 0',
    '@@load', '1 2 3',
    '@@mem', 'MemTotal: 1000 kB', 'MemAvailable: 400 kB', 'SwapTotal: 0 kB', 'SwapFree: 0 kB',
    '@@uptime', '42',
    '@@net', 'eth0: 100 0 0 0 0 0 0 200',
    '@@disk', '/dev/sda 100 50 50 50% /',
    '@@proc', '1 2.5 3.5 4 init',
    '@@cores', '2',
    '@@users', '1'
  ].join('\n')
  const result = parseMetrics(sample, { time: 0, cpuTotal: 900, cpuIdle: 700, rx: 0, tx: 0 }, 1000)
  assert.equal(result.snapshot.hostname, 'srv')
  assert.equal(result.snapshot.cpu, 50)
  assert.equal(result.snapshot.disks[0]?.mount, '/')
})

test('parses services and enabled state', () => {
  const services = parseServices(
    '● nginx.service loaded active running A web server',
    'nginx.service enabled'
  )
  assert.equal(services[0]?.enabled, 'enabled')
  assert.equal(services[0]?.active, 'active')
})

test('parses Docker JSON lines and nginx site blocks', () => {
  const containers = parseContainers('{"ID":"abc","Names":"web","Image":"nginx","State":"running"}')
  assert.equal(containers[0]?.name, 'web')
  const sites = parseSiteConfigs(
    '@@DIR:available\n@@FILE:/etc/nginx/sites-available/web\nserver_name example.test;\nroot /srv/web;\n'
  )
  assert.equal(sites[0]?.domains[0], 'example.test')
  assert.equal(sites[0]?.managed, true)
})
