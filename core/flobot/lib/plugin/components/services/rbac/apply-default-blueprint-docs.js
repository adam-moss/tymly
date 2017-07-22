const async = require('async')

module.exports = function applyBlueprintDocs (options, callback) {
  function makeTemplateRoleDoc (docId, docSource) {
    return {
      roleId: docId,
      label: docSource.label,
      description: docSource.description
    }
  }

  function makePermissionDoc (docId, docSource) {
    return {
      flowId: docSource.flowId,
      roleId: docSource.roleId,
      allows: docSource.allows
    }
  }

  function makeRoleMembershipDoc (docId, docSource) {
    return {
      roleId: docSource.templateRoleId,
      memberType: 'role',
      memberId: docSource.roleMemberId
    }
  }

  const blueprintDocs = options.bootedServices.blueprintDocs
  const roleModel = options.bootedServices.storage.models.fbot_role
  const roleMembershipModel = options.bootedServices.storage.models.fbot_roleMembership
  const permissionModel = options.bootedServices.storage.models.fbot_permission

  const docTasks = []

  options.messages.info('Applying unknown Blueprint documents')

    // Grab role-templates, default role-memberships and default role-grants
    // ---------------------------------------------------------------------

  let templateRole
  const templateRoles = options.blueprintComponents.templateRoles

  if (templateRoles) {
    for (let templateRoleId in templateRoles) {
      templateRole = templateRoles[templateRoleId]

      docTasks.push(
        {
          domain: 'templateRole',
          docId: templateRoleId,
          docSource: templateRole,
          dao: roleModel,
          docMaker: makeTemplateRoleDoc

        }
            )

      if (templateRole.hasOwnProperty('grants')) {
        templateRole.grants.forEach(
                    function (grant) {
                      const source = grant
                      source.roleId = templateRoleId

                      docTasks.push(
                        {
                          domain: 'roleGrant',
                          docId: templateRoleId + '_' + grant.flowId,
                          docSource: source,
                          dao: permissionModel,
                          docMaker: makePermissionDoc
                        }
                        )
                    }
                )
      }

      if (templateRole.hasOwnProperty('roleMemberships')) {
        templateRole.roleMemberships.forEach(
                    function (roleMemberId) {
                      docTasks.push(
                        {
                          domain: 'roleMembership',
                          docId: templateRoleId + '_' + roleMemberId,
                          docSource: {
                            templateRoleId: templateRoleId,
                            roleMemberId: templateRole.namespace + '_' + roleMemberId
                          },
                          dao: roleMembershipModel,
                          docMaker: makeRoleMembershipDoc
                        }
                        )
                    }

                )
      }
    }
  }

    // Grab restrictions from flows
    // ----------------------------

  let flow
  const flows = options.blueprintComponents.flows
  if (flows) {
    for (let flowId in flows) {
      flow = flows[flowId]
      if (flow.hasOwnProperty('restrictions')) {
        flow.restrictions.forEach(
                    function (restriction) {
                      const source = restriction
                      source.flowId = flowId

                      docTasks.push(
                        {
                          domain: 'flowRestriction',
                          docId: flowId + '_' + restriction.roleId,
                          docSource: source,
                          dao: permissionModel,
                          docMaker: makePermissionDoc
                        }
                        )
                    }
                )
      }
    }
  }

  const knownDocs = {}

  async.forEach(
        ['templateRole', 'roleGrant', 'flowRestriction', 'roleMembership'],

        function (domain, cb) {
          blueprintDocs.getDomainDocIds(
                domain,
                function (err, docIds) {
                  if (err) {
                    cb(err)
                  } else {
                    knownDocs[domain] = docIds
                    cb(null)
                  }
                }
            )
        },

        function (err) {
          if (err) {
            callback(err)
          } else {
                // So now we have all the known docIds, grouped by domain, and all
                // docs required from the blueprints... so for all unknown docs, go make them.

            async.forEach(
                    docTasks,
                    function (task, cb) {
                      if (knownDocs[task.domain].indexOf(task.docId) === -1) {
                            // Unknown!

                        const doc = task.docMaker(task.docId, task.docSource)

                        task.dao.create(
                                doc,
                          {},
                                function (err) {
                                  if (err) {
                                    cb(err)
                                  } else {
                                    blueprintDocs.registerDocument(
                                            task.domain,
                                            task.docId,
                                            cb
                                        )
                                  }
                                }
                            )
                      } else {
                            // Known!
                        cb(null)
                      }
                    },
                    function (err) {
                      if (err) {
                        callback(err)
                      } else {
                        callback(null)
                      }
                    }
                )
          }
        }
    )
}
