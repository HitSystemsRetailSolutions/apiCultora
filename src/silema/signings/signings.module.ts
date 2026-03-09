import { Module } from '@nestjs/common';
import { signingsController } from './signings.controller';
import { signingsService } from './signings.service';
import { ConnectionModule } from 'src/connection/connection.module';

@Module({
    imports: [ConnectionModule],
    controllers: [signingsController],
    providers: [signingsService],
})
export class SigningsModule { }
