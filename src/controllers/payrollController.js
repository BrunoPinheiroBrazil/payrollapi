import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { payrollService } from "../services/payrollService.js";

export const payrollController = {
  async getSummary(req, res) {
    try {
      const summary = await payrollService.getEmployeePayrollSummary(
        req.params.id,
      );
      req.log.info(
        { employeeId: req.params.id, summary },
        "Resumo de folha de pagamento recuperado com sucesso",
      );
      return res.status(200).json(summary);
    } catch (error) {
      req.log.error({ err: error, employeeId: req.params.id }, "Erro ao recuperar resumo de folha de pagamento");
      if (error.message === "EMPLOYEE_NOT_FOUND") {
        return res.status(404).json({ error: "Colaborador não encontrado" });
      }
      return res.status(500).json({ error: "Erro interno" });
    }
  },
  async handleSqsWebhook(req, res) {
    try {
      const { eventId, employeeId, amount } = req.body;
      req.log.info(
        { eventId, employeeId },
        "Processando evento recebido da fila SQS",
      );

      const result = await payrollService.processPayrollEvent({
        eventId,
        employeeId,
        amount,
      });

      if (result.status === "IGNORED_DUPLICATE") {
        req.log.warn({ eventId }, "Evento duplicado ignorado por idempotência");
      }

      return res.status(200).json(result);
    } catch (error) {
      req.log.error({ err: error }, "Falha crítica ao processar evento SQS");
      return res.status(500).json({ error: "Falha ao processar evento" });
    }
  },
  async seedDatabase(req, res) {
    try {
      const total = Number(req.body?.total) || 50000;
      const stats = await payrollService.generateMassData(total);
      req.log.info({ total }, "Iniciando carga massiva de dados");
      return res
        .status(201)
        .json({ message: "Carga massiva concluída!", ...stats });
    } catch (error) {
      req.log.error({ err: error }, "Falha ao gerar dados massivos");
      return res.status(500).json({ error: error.message });
    }
  },
  // Streaming real do Cursor do MongoDB direto para o download CSV com Backpressure!
  async exportCsvStream(req, res) {
    try {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="adp-payroll-export.csv"',
      );

      const mongoCursor = payrollService.getExportCursor();

      async function* csvGenerator() {
        yield "employeeId,name,department,baseSalary,bonus,netSalary\n";
        for await (const emp of mongoCursor) {
          const gross = emp.baseSalary + emp.bonus;
          const net =
            gross * (1 - emp.taxProfile.inssRate - emp.taxProfile.irrfRate);
          yield `${emp.employeeId},${emp.name},${emp.department},${emp.baseSalary},${emp.bonus},${net.toFixed(2)}\n`;
          req.log.info({ employeeId: emp.employeeId }, "Exportando colaborador para CSV");
        }
      }

      await pipeline(Readable.from(csvGenerator()), res);
    } catch (error) {
      req.log.error({ err: error }, "Erro no stream:");
      if (!res.headersSent)
        res.status(500).json({ error: "Erro ao exportar CSV" });
    }
  }
};
