'use strict'
const debugPackage = require('debug')('statebox')
const stateMachines = require('./../../state-machines')
const _ = require('lodash')
const dottie = require('dottie')
const Status = require('../../Status')

class BaseState {
  constructor (stateName, stateMachine, stateDefinition, options) {
    this.name = stateName
    this.stateMachine = stateMachine
    this.stateMachineName = stateMachine.name
    this.definition = stateDefinition
    this.options = options
  }

  debug () {
    debugPackage(` - Created '${this.name}' ${this.stateType} within stateMachine '${this.stateMachine.name}'`)
  }

  updateCurrentStateName (nextStateName, nextResource, executionName) {
    const _this = this
    this.options.dao.updateCurrentStateName(
      nextStateName,
      nextResource,
      executionName,
      function (err) {
        if (err) {
          // TODO: Needs handling as per spec
          throw new Error(err)
        } else {
          _this.stateMachine.processState(executionName)
        }
      }
    )
  }

  runTaskFailure (executionDescription, options, callback) {
    let ctx = executionDescription.ctx
    const stateMachine = stateMachines.findStateMachineByName(executionDescription.stateMachineName)
    const stateDefinition = stateMachine.findStateDefinitionByName(executionDescription.currentStateName)
    const executionName = executionDescription.executionName

    let throwException = false
    if (stateDefinition.Catch) {
      let caughtException = false
      for (let catchBlock of stateDefinition.Catch) {
        let catchNext
        for (let exceptionName of catchBlock.ErrorEquals) {
          if (exceptionName === options.error || exceptionName === 'States.ALL') {
            catchNext = catchBlock.Next
            break
          }
        }

        if (catchNext) {
          caughtException = true
          const nextResource = stateMachine.findStateDefinitionByName(catchNext).Resource
          this.options.dao.setNextState(
            executionName, // executionName
            catchNext, // nextStateName
            nextResource,
            ctx, // ctx
            function (err) {
              if (err) {
                // TODO: Needs handling as per spec
                throw new Error(err)
              } else {
                stateMachine.processState(executionName)
              }
            }
          )
          break
        }
      }

      if (!caughtException) {
        // all catch blocks were evaluated, but no matches were found
        throwException = true
      }
    } else {
      // no catch blocks were defined in the state definition
      throwException = true
    }

    if (throwException) {
      const tracker = this.options.parallelBranchTracker
      tracker.registerChildExecutionFail(executionName)
      this.options.dao.failExecution(
        executionDescription,
        options.cause,
        options.error,
        function (err, failedExecutionDescription) {
          if (err) {
            callback(err)
          } else {
            callback(null, failedExecutionDescription)
          }
        }
      )
    }
  }

  runTaskHeartbeat (executionDescription, output, callback) {
    const executionName = executionDescription.executionName
    const tracker = this.options.parallelBranchTracker
    tracker.registerChildExecutionFail(executionName)
    executionDescription.ctx = _.defaults(output, executionDescription.ctx)
    this.options.dao.setNextState(
      executionName, // executionName
      executionDescription.currentStateName, // nextStateName
      executionDescription.currentResource, // nextResource
      executionDescription.ctx, // ctx
      function (err) {
        if (err) {
          callback(err)
        } else {
          callback(null, executionDescription)
        }
      }
    )
  }

  processTaskHeartbeat (output, executionName, callback) {
    const _this = this
    this.options.dao.findExecutionByName(
      executionName,
      function (err, executionDescription) {
        if (err) {
          // TODO: Handle this as per spec!
          throw (err)
        } else {
          _this.runTaskHeartbeat(
            executionDescription,
            output,
            callback
          )
        }
      }
    )
  }

  processTaskFailure (options, executionName) {
    const _this = this
    this.options.dao.findExecutionByName(
      executionName,
      function (err, executionDescription) {
        if (err) {
          // TODO: Handle this as per spec!
          throw (err)
        } else {
          _this.runTaskFailure(
            executionDescription,
            options,
            function (err, failedExecutionDescription) {
              if (err) {
                throw new Error(err)
              } else {
                const registeredCallback = _this.options.callbackManager.getAndRemoveCallback(Status.COMPLETE, executionName)
                if (registeredCallback) {
                  registeredCallback(null, failedExecutionDescription)
                }
              }
            }
          )
        }
      }
    )
  }

  runTaskSuccess (executionDescription, output) {
    const _this = this
    const executionName = executionDescription.executionName
    let ctx = executionDescription.ctx
    if (output) {
      if (this.resultPath) {
        dottie.set(ctx, this.resultPath, output)
      } else {
        ctx = _.defaults(output, ctx)
      }
    }
    const stateMachine = stateMachines.findStateMachineByName(executionDescription.stateMachineName)
    const stateDefinition = stateMachine.findStateDefinitionByName(executionDescription.currentStateName)

    // END
    if (stateDefinition.End) {
      this.options.dao.succeedExecution(
        executionName,
        ctx,
        function (err, succeededExecutionDescription) {
          if (err) {
            // TODO: Needs handling as per spec
            throw new Error(err)
          } else {
            const parentExecutionName = executionDescription.executionOptions.parentExecutionName
            if (parentExecutionName) {
              // Has a parent flow, so see if the related parallel state can advance
              const tracker = _this.options.parallelBranchTracker
              tracker.registerChildExecutionEnd(executionDescription.executionName)
              const parallelStateStatus = tracker.getParallelTaskStatus(parentExecutionName)
              if (parallelStateStatus === Status.SUCCEEDED) {
                debugPackage(`All branches have now succeeded (executionName='${executionDescription.executionOptions.parentExecutionName}')`)
                _this.processTaskSuccess(ctx, parentExecutionName)
              }
            } else {
              // No branching, so finished everything... might need to call a callback?
              const registeredCallback = _this.options.callbackManager.getAndRemoveCallback(Status.COMPLETE, executionName)
              if (registeredCallback) {
                registeredCallback(null, succeededExecutionDescription)
              }
            }
          }
        }
      )
    } else {
      // NEXT
      const nextResource = stateMachine.findStateDefinitionByName(stateDefinition.Next).Resource
      this.options.dao.setNextState(
        executionName, // executionName
        stateDefinition.Next, // nextStateName
        nextResource,
        ctx, // ctx
        function (err) {
          if (err) {
            // TODO: Needs handling as per spec
            throw new Error(err)
          } else {
            stateMachine.processState(executionName)
          }
        }
      )
    }
  }

  processTaskSuccess (output, executionName) {
    const _this = this
    this.options.dao.findExecutionByName(
      executionName,
      function (err, executionDescription) {
        if (err) {
          // TODO: Handle this as per spec!
          throw new Error(err)
        } else {
          _this.runTaskSuccess(executionDescription, output)
        }
      }
    )
  }
}

module.exports = BaseState
