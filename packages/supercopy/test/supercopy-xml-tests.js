/* eslint-env mocha */

'use strict'

const debug = require('debug')('supercopy')
const path = require('path')
const expect = require('chai').expect
const supercopy = require('../lib/index.js')
const pg = require('pg')
const sqlScriptRunner = require('./fixtures/sql-script-runner')
const fs = require('fs')
const rimraf = require('rimraf')

describe('Supercopy data from an xml file', function () {
  this.timeout(5000)

  const connectionString = process.env.PG_CONNECTION_STRING
  let client

  it('Should remove output directory ahead of xml tests, if it exists already', function (done) {
    const outputPath = path.resolve(__dirname, './output')
    if (fs.existsSync(outputPath)) {
      rimraf(outputPath, done)
    } else {
      done()
    }
  })
  it('Should load some test data', (done) => {
    client = new pg.Client(connectionString)
    client.connect()

    sqlScriptRunner(
      [
        'uninstall.sql',
        'install.sql'
      ],
      client,
      function (err) {
        expect(err).to.equal(null)
        done()
      }
    )
  })

  it('Should supercopy some people with XML conversion', function (done) {
    supercopy(
      {
        sourceDir: path.resolve(__dirname, './output/establishment'),
        topDownTableOrder: ['adults', 'children'],
        headerColumnNamePkPrefix: '.',
        client: client,
        schemaName: 'supercopy_test',
        debug: true,
        truncateFirstTables: true,
        triggerElement: 'EstablishmentDetail',
        xmlSourceFile: path.resolve(__dirname, './fixtures/input-data/establishment.xml')
      },
      function (err) {
        expect(err).to.equal(null)
        done()
      }
    )
  })

  it('Should return correctly populated rows', function (done) {
    client.query(
      'select fhrsid, businessname from supercopy_test.establishment order by fhrsid',
      function (err, result) {
        if (err) {
          debug('err', err)
        }
        expect(err).to.equal(null)
        expect(result.rowCount).to.eql(3)
        done()
      }
    )
  })

  it('Cleanup test data', function (done) {
    client = new pg.Client(connectionString)
    client.connect()

    sqlScriptRunner(
      [
        'uninstall.sql'
      ],
      client,
      function (err) {
        expect(err).to.equal(null)
        done()
      }
    )
  })
})
