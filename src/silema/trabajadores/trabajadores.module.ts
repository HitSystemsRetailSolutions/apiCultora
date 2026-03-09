import { Module } from '@nestjs/common';
import { trabajadoresController } from './trabajadores.controller';
import { trabajadoresService } from './trabajadores.service';
import { ConnectionModule } from 'src/connection/connection.module';

@Module({
    imports: [ConnectionModule],
    controllers: [trabajadoresController],
    providers: [trabajadoresService],
})
export class TrabajadoresModule { }
