import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { payrollController } from "../../src/controllers/payrollController.js";
import { payrollService } from "../../src/services/payrollService.js";

describe("payrollController", () => {
  let req;
  let res;

  // Reseta os mocks de req, res e limpa spies antes de cada teste
  beforeEach(() => {
    mock.restoreAll();

    req = {
      params: {},
      body: {},
      log: {
        info: mock.fn(),
        warn: mock.fn(),
        error: mock.fn(),
      },
    };

    res = {
      headersSent: false,
      statusCode: null,
      body: null,
      headers: {},
      status: mock.fn(function (code) {
        this.statusCode = code;
        return this;
      }),
      json: mock.fn(function (data) {
        this.body = data;
        return this;
      }),
      setHeader: mock.fn(function (key, value) {
        this.headers[key] = value;
      }),
    };
  });

  describe("getSummary", () => {
    it("deve retornar 200 e o resumo da folha quando encontrado", async () => {
      req.params.id = "emp-123";
      const fakeSummary = { employeeId: "emp-123", netSalary: 5000 };

      mock.method(
        payrollService,
        "getEmployeePayrollSummary",
        async () => fakeSummary,
      );

      await payrollController.getSummary(req, res);

      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body, fakeSummary);
      assert.equal(req.log.info.mock.callCount(), 1);
    });

    it("deve retornar 404 quando o colaborador não for encontrado", async () => {
      req.params.id = "emp-999";

      mock.method(payrollService, "getEmployeePayrollSummary", async () => {
        throw new Error("EMPLOYEE_NOT_FOUND");
      });

      await payrollController.getSummary(req, res);

      assert.equal(res.statusCode, 404);
      assert.deepEqual(res.body, { error: "Colaborador não encontrado" });
      assert.equal(req.log.error.mock.callCount(), 1);
    });

    it("deve retornar 500 para erros inesperados", async () => {
      req.params.id = "emp-123";

      mock.method(payrollService, "getEmployeePayrollSummary", async () => {
        throw new Error("DB_CONNECTION_ERROR");
      });

      await payrollController.getSummary(req, res);

      assert.equal(res.statusCode, 500);
      assert.deepEqual(res.body, { error: "Erro interno" });
    });
  });

  describe("handleSqsWebhook", () => {
    it("deve processar o evento SQS e retornar 200", async () => {
      req.body = { eventId: "evt-1", employeeId: "emp-1", amount: 1500 };
      const fakeResult = { status: "PROCESSED", eventId: "evt-1" };

      mock.method(
        payrollService,
        "processPayrollEvent",
        async () => fakeResult,
      );

      await payrollController.handleSqsWebhook(req, res);

      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body, fakeResult);
      assert.equal(req.log.warn.mock.callCount(), 0);
    });

    it("deve registrar um warn quando o evento for duplicado", async () => {
      req.body = { eventId: "evt-dup", employeeId: "emp-1", amount: 1500 };
      const fakeResult = { status: "IGNORED_DUPLICATE" };

      mock.method(
        payrollService,
        "processPayrollEvent",
        async () => fakeResult,
      );

      await payrollController.handleSqsWebhook(req, res);

      assert.equal(res.statusCode, 200);
      assert.equal(req.log.warn.mock.callCount(), 1);
    });

    it("deve retornar 500 se o processamento falhar", async () => {
      req.body = { eventId: "evt-err" };

      mock.method(payrollService, "processPayrollEvent", async () => {
        throw new Error("SQS_ERROR");
      });

      await payrollController.handleSqsWebhook(req, res);

      assert.equal(res.statusCode, 500);
      assert.deepEqual(res.body, { error: "Falha ao processar evento" });
    });
  });

  describe("seedDatabase", () => {
    it("deve usar o valor padrão de 50000 quando total não for enviado", async () => {
      const generateMock = mock.method(
        payrollService,
        "generateMassData",
        async () => ({ inserted: 50000 }),
      );

      await payrollController.seedDatabase(req, res);

      assert.equal(generateMock.mock.calls[0].arguments[0], 50000);
      assert.equal(res.statusCode, 201);
      assert.deepEqual(res.body, {
        message: "Carga massiva concluída!",
        inserted: 50000,
      });
    });

    it("deve respeitar o valor de total enviado no body", async () => {
      req.body = { total: 100 };
      const generateMock = mock.method(
        payrollService,
        "generateMassData",
        async () => ({ inserted: 100 }),
      );

      await payrollController.seedDatabase(req, res);

      assert.equal(generateMock.mock.calls[0].arguments[0], 100);
      assert.equal(res.statusCode, 201);
    });

    it("deve retornar 500 com a mensagem do erro caso falhe", async () => {
      mock.method(payrollService, "generateMassData", async () => {
        throw new Error("Memória insuficiente");
      });

      await payrollController.seedDatabase(req, res);

      assert.equal(res.statusCode, 500);
      assert.deepEqual(res.body, { error: "Memória insuficiente" });
    });
  });

  describe("exportCsvStream", () => {
    it("deve fazer o stream do CSV corretamente com o cálculo líquido", async () => {
      // Simula o cursor assíncrono do MongoDB
      async function* fakeCursor() {
        yield {
          employeeId: "10",
          name: "Ana Silva",
          department: "TI",
          baseSalary: 10000,
          bonus: 2000,
          taxProfile: { inssRate: 0.1, irrfRate: 0.15 }, // 25% de desconto sobre 12000 = 9000
        };
      }

      mock.method(payrollService, "getExportCursor", () => fakeCursor());

      // Usa PassThrough para simular o objeto res como uma Writable Stream real
      const streamRes = new PassThrough();
      streamRes.headers = {}; // <-- Propriedade que estava faltando
      streamRes.setHeader = res.setHeader;
      streamRes.status = res.status;
      streamRes.json = res.json;
      streamRes.headersSent = false;

      let csvOutput = "";
      streamRes.on("data", (chunk) => {
        csvOutput += chunk.toString();
      });

      await payrollController.exportCsvStream(req, streamRes);

      assert.equal(
        streamRes.headers["Content-Type"],
        "text/csv; charset=utf-8",
      );
      assert.equal(
        streamRes.headers["Content-Disposition"],
        'attachment; filename="adp-payroll-export.csv"',
      );

      const expectedCsv =
        "employeeId,name,department,baseSalary,bonus,netSalary\n" +
        "10,Ana Silva,TI,10000,2000,9000.00\n";

      assert.equal(csvOutput, expectedCsv);
    });

    it("deve retornar 500 se o stream falhar antes dos headers serem enviados", async () => {
      mock.method(payrollService, "getExportCursor", () => {
        throw new Error("Cursor fechado");
      });

      await payrollController.exportCsvStream(req, res);

      assert.equal(res.statusCode, 500);
      assert.deepEqual(res.body, { error: "Erro ao exportar CSV" });
    });
  });
});
