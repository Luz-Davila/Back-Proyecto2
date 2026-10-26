import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { Public } from '../auth/public.decorator';

@ApiTags('Salud')
@Controller('health')
export class HealthController {
  constructor(private readonly dataSource: DataSource) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Comprueba que la API y la base de datos responden' })
  @ApiOkResponse({
    description: 'Servicio operativo',
    schema: { example: { status: 'ok', database: 'up' } },
  })
  async check() {
    await this.dataSource.query('SELECT 1');
    return { status: 'ok', database: 'up' };
  }
}
