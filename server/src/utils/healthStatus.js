export function getReadiness(readyState) {
  const databaseConnected = readyState === 1;

  return {
    httpStatus: databaseConnected ? 200 : 503,
    status: databaseConnected ? 'ok' : 'degraded',
    dependencies: {
      database: databaseConnected ? 'connected' : 'unavailable',
    },
  };
}
