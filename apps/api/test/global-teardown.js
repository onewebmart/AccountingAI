/** Stops the shared replica set started by global-setup. */
module.exports = async () => {
  const replSet = globalThis.__MONGO_REPLSET__;
  if (replSet) {
    await replSet.stop();
  }
};
