'use strict'

class GetBoard {
  init (resourceConfig, env, callback) {
    this.models = env.bootedServices.storage.models
    this.modelName = resourceConfig.model
    callback(null)
  }

  run (event, context) {
    const model = this.models[`${context.stateMachineMeta.namespace}_${this.modelName}`]
    const where = {}

    Object.keys(event).map(k => {
      where[k] = {equals: event[k]}
    })

    model.findOne({where}, (err, doc) => {
      if (err) context.sendTaskFailure({error: 'getBoardFail', cause: err})
      context.sendTaskSuccess(doc)
    })
  }
}

module.exports = GetBoard
