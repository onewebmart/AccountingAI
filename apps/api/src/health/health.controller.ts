import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService, MongooseHealthIndicator } from '@nestjs/terminus';
import { Public } from '../auth/decorators';

@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private mongoose: MongooseHealthIndicator,
  ) {}

  /** Public by design — load balancers and uptime probes cannot present a JWT. */
  @Public()
  @Get()
  @HealthCheck()
  check() {
    return this.health.check([() => this.mongoose.pingCheck('mongodb')]);
  }
}
