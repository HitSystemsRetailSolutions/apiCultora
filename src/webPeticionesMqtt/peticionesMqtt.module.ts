import { Module } from '@nestjs/common';
import { peticionesMqttController } from './peticionesMqtt.controller';
import { peticionesMqttService } from './peticionesMqtt.service';
import { ConnectionModule } from 'src/connection/connection.module';

@Module({
    imports: [ConnectionModule],
    controllers: [peticionesMqttController],
    providers: [peticionesMqttService],
})
export class PeticionesMqttModule { }
