function formatFailure(error) {
  if (error instanceof Error) return error.stack || error.message
  return String(error)
}

function logFailure(scope, error, details) {
  const suffix = details ? ` ${JSON.stringify(details)}` : ''
  console.error(`[tedit:${scope}]${suffix}\n${formatFailure(error)}`)
}

function installProcessFailureLogging() {
  process.on('uncaughtExceptionMonitor', (error, origin) => logFailure('uncaught-exception', error, { origin }))
  process.on('unhandledRejection', (error) => logFailure('unhandled-rejection', error))
}

module.exports = { formatFailure, installProcessFailureLogging, logFailure }
