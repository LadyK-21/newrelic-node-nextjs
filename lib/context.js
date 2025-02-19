/*
 * Copyright 2022 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const util = require('util')

module.exports = function initialize(shim, ctx) {
  /*
  Middleware is tracked via a 'module context' object
  whose `_ENTRIES` property is updated by each middleware layer.
  So, we proxy `_ENTRIES` and record a span whenever middleware modifies it.
  */
  shim.setFramework(shim.NEXT)
  const isAsync = util.types.isAsyncFunction(ctx.getModuleContext)
  shim.wrap(ctx, 'getModuleContext', function middlewareRecorder(shim, getModuleContext) {
    // define proxy handler that adds a set trap and re-assigns the middleware handler
    // with a wrapped function to record the middleware handler execution.
    const handler = {
      set(obj, prop, value) {
        const nrObj = Object.assign(Object.create(null), value)
        const middlewareName = prop.replace(/^middleware_pages/, '')
        shim.record(nrObj, 'default', function mwRecord(shim, origMw, name, [args]) {
          return {
            name: `${shim._metrics.MIDDLEWARE}${shim._metrics.PREFIX}${middlewareName}`,
            type: shim.MIDDLEWARE,
            req: args.request,
            route: middlewareName,
            promise: true
          }
        })
        obj[prop] = nrObj
        return true
      }
    }

    /**
     * Check if the context._ENTRIES object is a proxy, and make it one if not.
     * @param {Object} moduleContext return of `getModuleContext`
     */
    function maybeApplyProxyHandler(moduleContext) {
      if (!util.types.isProxy(moduleContext.context._ENTRIES)) {
        moduleContext.context._ENTRIES = new Proxy(moduleContext.context._ENTRIES, handler)
      }
    }

    // In 12.1.1 `getModuleContext` became async
    // see: https://github.com/vercel/next.js/pull/34437/files#diff-071a8410458475238acf837aa65ab1016398606a4d896d624db618b7fdb889c4
    if (isAsync) {
      return async function wrappedModuleContextPromise() {
        const result = await getModuleContext.apply(this, arguments)
        maybeApplyProxyHandler(result)
        return result
      }
    }
    return function wrappedModuleContext() {
      const result = getModuleContext.apply(this, arguments)
      maybeApplyProxyHandler(result)
      return result
    }
  })
}
