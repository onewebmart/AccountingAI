import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';

@Module({
  imports: [
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const uri = config.get<string>('mongodb.uri');
        if (!uri) throw new Error('MONGODB_URI is not configured');

        // Enforce replica set in the URI — transactions require it
        if (!uri.includes('replicaSet') && !uri.includes('mongodb+srv')) {
          throw new Error(
            'MongoDB must be configured as a replica set. ' +
              'Add "?replicaSet=rs0" to MONGODB_URI. ' +
              'See README for local single-node RS setup.',
          );
        }

        return {
          uri,
          // Mongoose 8 defaults — be explicit for clarity
          serverSelectionTimeoutMS: 5000,
          socketTimeoutMS: 45000,
        };
      },
    }),
  ],
  exports: [MongooseModule],
})
export class DatabaseModule {}
