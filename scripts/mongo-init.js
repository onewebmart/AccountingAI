// MongoDB replica set init script
// Runs inside Docker on first startup.
// Transactions require a replica set — this is why we always run as RS.

try {
  rs.status();
  print('Replica set already initialized');
} catch (e) {
  print('Initializing replica set rs0...');
  rs.initiate({
    _id: 'rs0',
    members: [{ _id: 0, host: 'localhost:27017' }],
  });
  print('Replica set initialized');
}
