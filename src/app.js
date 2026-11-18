import express from 'express';
import { employeeRepository } from './repositories/employeeRepository.js';
import { payrollController } from './controllers/payrollController.js';
import { httpLogger, logger } from './utils/logger.js';

const app = express();
app.use(express.json());
app.use(httpLogger);

app.post('/api/payroll/seed', payrollController.seedDatabase);
app.get('/api/payroll/export/csv', payrollController.exportCsvStream);
app.get('/api/payroll/:id', payrollController.getSummary);
app.post('/api/payroll/events', payrollController.handleSqsWebhook);

const PORT = 3000;

employeeRepository.connect().then(() => {
  app.listen(PORT, () => {
    logger.info({ port: PORT }, 'ADP Payroll API iniciada com sucesso');
  });
});