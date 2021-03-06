'use strict'
const BaseStateType = require('./Base-state')
const resources = require('./../../resources')
const boom = require('boom')
const jp = require('jsonpath')
const convertJsonpathToDottie = require('./../../utils/convert-jsonpath-to-dottie')
const process = require('process')
const _ = require('lodash')
const debug = require('debug')('statebox')

// TODO: http://docs.aws.amazon.com/lambda/latest/dg/nodejs-prog-model-context.html
class Context {
  constructor (executionDescription, task) {
    this.executionName = executionDescription.executionName
    this.executionOptions = executionDescription.executionOptions
    this.userId = executionDescription.executionOptions.userId
    this.stateMachineMeta = task.stateMachine.meta
    this.task = task
  }

  sendTaskSuccess (output) {
    debug(`sendTaskSuccess(${this.executionName})`)
    this.task.processTaskSuccess(output, this.executionName)
  }

  sendTaskFailure (options) {
    debug(`sendTaskFailure(${this.executionName})`)
    this.task.processTaskFailure(options, this.executionName)
  }

  sendTaskHeartbeat (output, callback) {
    debug(`sendTaskHeartbeat(${this.executionName})`)
    if (!callback) {
      console.log(new Error('Missing callback parameter in call to sendTaskHeartbeat'))
      callback = () => {}
    }
    this.task.processTaskHeartbeat(output, this.executionName, callback)
  }

  _resolveInputPaths (input, root) {
    // TODO: Support string-paths inside arrays
    const _this = this
    if (_.isArray(root)) {
      root.forEach(
        function (element) {
          _this._resolveInputPaths(input, element)
        }
      )
    } else if (_.isObject(root)) {
      _.forOwn(
        root,
        function (value, key) {
          if (_.isString(value) && value.length > 0 && value[0] === '$') {
            root[key] = jp.value(input, value)
          } else {
            _this._resolveInputPaths(input, value)
          }
        }
      )
    }
  }

  resolveInputPaths (input, template) {
    let clonedInput
    if (_.isObject(input)) {
      clonedInput = _.cloneDeep(input)
    } else {
      clonedInput = {}
    }

    let clonedTemplate
    if (template) {
      clonedTemplate = _.cloneDeep(template)
    } else {
      clonedTemplate = {}
    }

    this._resolveInputPaths(clonedInput, clonedTemplate)
    return clonedTemplate
  }
}

class Task extends BaseStateType {
  constructor (stateName, stateMachine, stateDefinition, options) {
    super(stateName, stateMachine, stateDefinition, options)
    if (stateDefinition.Resource) {
      this.stateType = 'Task'
      const parts = stateDefinition.Resource.split(':')
      this.resourceType = parts[0]
      this.ResourceConfig = stateDefinition.ResourceConfig
      switch (this.resourceType) {
        case 'module':
          const moduleName = parts[1]
          this.ResourceClass = resources.findModuleByName(moduleName)
          if (!this.ResourceClass) {
            // Should be picked-up by stateMachine validation before now
            throw (boom.badRequest(`Unable to bind Task '${stateName}' in stateMachine '${this.stateMachineName}' - module class '${moduleName}' not found`, moduleName))
          }
          break
      }

      this.inputPath = stateDefinition.InputPath || '$'
      this.resultPath = convertJsonpathToDottie(stateDefinition.ResultPath)
    } else {
      throw (boom.badRequest(`Unable to create Task '${stateName}' in stateMachine '${this.stateMachineName}' - no 'Resource' property set?`))
    }
  }

  stateTypeInit (env, callback) {
    const _this = this
    this.resource = new this.ResourceClass()
    this.resourceExpectsDoneCallback = this.resource.run.length === 3

    if (_.isFunction(this.resource.init)) {
      this.resource.init(_this.definition.ResourceConfig || {}, env, (err) => {
        if (err) return callback(err)
        if (_.get(this.resource, 'schema.required')) {
          this.resource.schema.required.map(requiredProperty => {
            if (this.ResourceConfig) {
              if (!Object.keys(this.ResourceConfig).includes(requiredProperty)) {
                callback(new Error(`Resource Config missing required properties in stateMachine '${this.stateMachineName}'`))
              } else {
                switch (this.resource.schema.properties[requiredProperty].type) {
                  case 'object':
                    if (!_.isPlainObject(this.ResourceConfig[requiredProperty])) {
                      callback(new Error(`Resource config property '${requiredProperty}' in stateMachine '${this.stateMachineName}' should be an object`))
                    }
                    break
                  case 'string':
                    if (!_.isString(this.ResourceConfig[requiredProperty])) {
                      callback(new Error(`Resource config property '${requiredProperty}' in stateMachine '${this.stateMachineName}' should be a string`))
                    }
                    break
                }
              }
            } else {
              callback(new Error(`State machine '${this.stateMachineName}' is missing a ResourceConfig`))
            }
          })

          callback(null)
        } else {
          callback(null)
        }
      })
    } else {
      callback(null)
    }
  }

  process (executionDescription, optionalDoneCallback) {
    const _this = this
    const input = jp.value(executionDescription.ctx, this.inputPath)
    const context = new Context(executionDescription, this)

    process.nextTick(
      function () {
        try {
          _this.resource.run(
            input,
            context,
            optionalDoneCallback
          )
        } catch (e) {
          console.error(
            '\nUNHANDLED EXCEPTION WHILE PROCESSING TASK ------------------------------------\n' +
            `error: ${e}\n` +
            `executionName: ${executionDescription.executionName}\n` +
            `stateMachineName: ${executionDescription.stateMachineName}\n` +
            `currentStateName: ${executionDescription.currentStateName}\n` +
            `parentExecutionName: ${executionDescription.executionOptions.parentExecutionName}\n` +
            `rootExecutionName: ${executionDescription.executionOptions.rootExecutionName}\n` +
            `startDate: ${executionDescription.startDate}\n` +
            `ctx: ${JSON.stringify(executionDescription.ctx)}\n\n` +
            'STACK\n' +
            '-----\n' +
            e.stack + '\n' +
            '------------------------------------------------------------------------------\n'
          )
          // TODO: Sending out error details might leak security info... implement "dev mode" flag?
          _this.processTaskFailure(
            {
              error: 'States.TaskFail',
              cause: e.toString()
            },
            executionDescription.executionName
          )
        }
      }
    )
  }
}

module.exports = Task
