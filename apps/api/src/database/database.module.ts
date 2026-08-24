import { Logger, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import type { Connection } from 'mongoose';

@Module({
  imports: [
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const uri = config.get<string>('mongodb.uri');
        if (!uri) throw new Error('MONGODB_URI is not configured');

        // Transactions (Invariant 8) require a replica-set member. Reach one either by
        // letting the driver discover the set (`replicaSet=` / `mongodb+srv`) or by
        // talking straight to a single member (`directConnection=true`). The direct form
        // is required when the set advertises an address the client cannot reach — e.g. a
        // containerised single-node RS that advertises `localhost:27017` but is published
        // on a different host port. Actual membership is verified against the live server
        // in connectionFactory below, so this check cannot be satisfied by a standalone.
        const discoversSet = uri.includes('replicaSet') || uri.includes('mongodb+srv');
        const directToMember = uri.includes('directConnection=true');
        if (!discoversSet && !directToMember) {
          throw new Error(
            'MongoDB must be configured as a replica set. Add "?replicaSet=rs0" to ' +
              'MONGODB_URI, or "?directConnection=true" when connecting straight to a ' +
              'single-node RS member. See README for local single-node RS setup.',
          );
        }

        return {
          uri,
          // Mongoose 8 defaults — be explicit for clarity
          serverSelectionTimeoutMS: 5000,
          socketTimeoutMS: 45000,
          connectionFactory: (connection: Connection) => {
            connection.once('open', () => {
              void connection.db
                ?.admin()
                .command({ hello: 1 })
                .then((res: { setName?: string }) => {
                  if (!res.setName) {
                    new Logger('DatabaseModule').error(
                      'Connected mongod is NOT a replica-set member — multi-document ' +
                        'transactions are unavailable, so the posting service cannot ' +
                        'uphold Invariants 2, 6 and 7. Refusing to run against a standalone.',
                    );
                    process.exit(1);
                  }
                })
                .catch((err: Error) => {
                  new Logger('DatabaseModule').error(
                    `Could not verify replica-set membership: ${err.message}`,
                  );
                  process.exit(1);
                });
            });
            return connection;
          },
        };
      },
    }),
  ],
  exports: [MongooseModule],
})
export class DatabaseModule {}
