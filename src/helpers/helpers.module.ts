import { Module } from '@nestjs/common';
import { HelpersController } from './helpers.controller';
import { helpersService } from './helpers.service';

@Module({
    controllers: [HelpersController],
    providers: [helpersService],
    exports: [helpersService],
})
export class HelpersModule { }
