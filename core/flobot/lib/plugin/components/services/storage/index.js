'use strict'

const _ = require('lodash')
const MemoryModel = require('./Memory-model')
const fs = require('fs')
const split = require('split')
const path = require('path')
const EJSON = require('mongodb-extended-json')

class MemoryStorageService {

  boot (options, callback) {
    const _this = this
    this.storageName = 'memory'
    this.models = {}

    const modelDefinitions = options.blueprintComponents.models || {}

    options.messages.info('Using memory storage...')

    _.forOwn(
      modelDefinitions,
      function (modelDefinition, modelId) {
        options.messages.detail(modelId)
        _this.models[modelId] = new MemoryModel(modelDefinition)
      }
    )

    callback(null)
  }

  fileImporter (action, modelId, rootDir, fileInfo, importReport, callback) {
    const model = this.models[modelId]
    const primaryKey = this.models[modelId].primaryKey

    if (model) {
      const filePath = path.resolve(rootDir, fileInfo.filePath)

      const readStream = fs.createReadStream(filePath)
      readStream.pipe(split())

        // For each line
        // -------------
        .on('data', function (line) {
          if (line[0] === '{') {
            const data = EJSON.parse(line)
            switch (action) {

              case 'upsert':

                const where = {}
                primaryKey.forEach(
                function (key) {
                  where[key] = data[key]
                }
              )

                model.upsert(data, {}, function () {}) // In-memory is sync really (so this is OK)

                break
            }
          }
        })
        .on('end', function () {
          callback(null)
        })
    } else {
      callback(
        {
          name: 'unknownModel',
          message: 'Unable to import file - unknown modelId ' + modelId
        }
      )
    }
  }

}

module.exports = {
  serviceClass: MemoryStorageService,

  configModifier: function flobotsServiceConfigModifier (ctx) {
    // Filter just to FSM options
    // --------------------------

    if (ctx.utils.isFsmOptions(ctx)) {
      ctx.utils.idNamespacer('modelId', 'models', ctx)
    }
  }
}
