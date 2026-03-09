import { Controller, Get } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';

@Controller('helpers')
export class HelpersController {
    @Get()
    getLogs() {
        const path = join(__dirname, '..', '..', 'logs', 'logs.json');
        const data = readFileSync(path, 'utf8');
        return JSON.parse(data);
    }
}
