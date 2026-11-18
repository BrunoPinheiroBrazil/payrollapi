import { employeeRepository } from '../repositories/employeeRepository.js';

export const payrollService = {
  async getEmployeePayrollSummary(employeeId) {
    const employee = await employeeRepository.findById(employeeId);
    if (!employee) throw new Error('EMPLOYEE_NOT_FOUND');

    const grossSalary = employee.baseSalary + employee.bonus;
    const { inssRate, irrfRate } = employee.taxProfile;
    const totalTaxes = grossSalary * (inssRate + irrfRate);

    return {
      employeeId: employee.employeeId,
      name: employee.name,
      department: employee.department,
      grossSalary,
      netSalary: Number((grossSalary - totalTaxes).toFixed(2))
    };
  },

  async processPayrollEvent({ eventId, employeeId, amount }) {
    // Idempotência garantida no nível do banco (atômica e thread-safe entre múltiplas instâncias!)
    const isFirstTime = await employeeRepository.tryLockEvent(eventId);

    if (!isFirstTime) {
      return { status: 'IGNORED_DUPLICATE', eventId, message: 'Evento já processado anteriormente.' };
    }

    return {
      status: 'PROCESSED',
      eventId,
      employeeId,
      creditedAmount: amount,
      processedAt: new Date().toISOString()
    };
  },

  async generateMassData(total) {
    const start = Date.now();
    const count = await employeeRepository.seedMassiveBatch(total);
    const durationMs = Date.now() - start;
    return { insertedRecords: count, timeTakenMs: durationMs };
  },

  getExportCursor() {
    return employeeRepository.getAllAsCursor();
  }
};