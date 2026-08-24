import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsEnum, IsISO8601, IsOptional, IsString, Length } from 'class-validator';
import { TaskPriority, TaskStatus } from '@ai-accounting/shared';
import { FirmAdminGuard } from '../../white-label/white-label.guard';
import { TasksService } from './tasks.service';

interface AuthRequest {
  user: { orgId: string; sub: string; role: string; firmId?: string };
}

export class CreateTaskDto {
  @IsString()
  @Length(1, 300)
  title: string;

  @IsOptional()
  @IsString()
  @Length(0, 2000)
  description?: string;

  @IsOptional()
  @IsString()
  clientOrgId?: string;

  @IsOptional()
  @IsString()
  assignedTo?: string;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  assigneeName?: string;

  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @IsOptional()
  @IsISO8601()
  dueDate?: string;
}

export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  @Length(1, 300)
  title?: string;

  @IsOptional()
  @IsString()
  @Length(0, 2000)
  description?: string;

  @IsOptional()
  @IsString()
  assignedTo?: string;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  assigneeName?: string;

  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @IsOptional()
  @IsISO8601()
  dueDate?: string;
}

export class ChangeStatusDto {
  @IsEnum(TaskStatus)
  status: TaskStatus;
}

@Controller('crm/tasks')
@UseGuards(AuthGuard('jwt'), FirmAdminGuard)
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  list(
    @Query('status') status?: TaskStatus,
    @Query('assignedTo') assignedTo?: string,
    @Query('clientOrgId') clientOrgId?: string,
  ) {
    return this.tasks.list({ status, assignedTo, clientOrgId });
  }

  @Get('summary')
  summary() {
    return this.tasks.summary();
  }

  @Post()
  create(@Request() req: AuthRequest, @Body() dto: CreateTaskDto) {
    return this.tasks.create({ firmId: req.user.firmId!, createdBy: req.user.sub, ...dto });
  }

  @Patch(':id')
  update(@Request() req: AuthRequest, @Param('id') id: string, @Body() dto: UpdateTaskDto) {
    return this.tasks.update(id, dto, req.user.sub);
  }

  @Post(':id/status')
  changeStatus(
    @Request() req: AuthRequest,
    @Param('id') id: string,
    @Body() dto: ChangeStatusDto,
  ) {
    return this.tasks.changeStatus(id, dto.status, req.user.sub);
  }

  @Delete(':id')
  async remove(@Request() req: AuthRequest, @Param('id') id: string) {
    await this.tasks.remove(id, req.user.sub);
    return { deleted: true };
  }
}
