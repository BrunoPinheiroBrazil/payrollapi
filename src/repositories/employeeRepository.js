import mongoose from 'mongoose';

// CONSELHO DE ARQUITETO 1: Embedding (Subdocumento)
// Como as regras fiscais são sempre lidas junto com o colaborador e têm tamanho fixo,
// embutimos no mesmo documento JSON para ler tudo em 1 único hit de disco (sem JOIN/$lookup).
const employeeSchema = new mongoose.Schema({
  employeeId: { type: String, required: true, unique: true }, // Índice único automático!
  name: { type: String, required: true },
  department: { type: String, index: true }, // Índice para filtros rápidos
  baseSalary: { type: Number, required: true },
  bonus: { type: Number, default: 0 },
  taxProfile: {
    inssRate: { type: Number, default: 0.11 },
    irrfRate: { type: Number, default: 0.275 }
  }
});

// CONSELHO DE ARQUITETO 2: Idempotência via Índice Único Atômico no Mongo
const processedEventSchema = new mongoose.Schema({
  eventId: { type: String, required: true, unique: true },
  processedAt: { type: Date, default: Date.now }
});

const Employee = mongoose.model('Employee', employeeSchema);
const ProcessedEvent = mongoose.model('ProcessedEvent', processedEventSchema);

export const employeeRepository = {
  async connect() {
    await mongoose.connect('mongodb://localhost:27017/adp_payroll');
    console.log('🍃 Conectado ao MongoDB no Docker!');
  },

  // .lean() retorna objetos JS puros em vez de instâncias pesadas do Mongoose (3x a 5x mais rápido!)
  async findById(employeeId) {
    return Employee.findOne({ employeeId }).lean();
  },

  // Gera lotes massivos usando insertMany (Bulk Write)
  async seedMassiveBatch(totalRecords = 50000) {
    await Employee.deleteMany({}); // Limpa base anterior para o teste
    const departments = ['Engineering', 'HR', 'Payroll', 'CloudOps', 'Product'];
    const BATCH_SIZE = 5000;
    let inserted = 0;

    for (let i = 1; i <= totalRecords; i += BATCH_SIZE) {
      const batch = [];
      const limit = Math.min(i + BATCH_SIZE - 1, totalRecords);

      for (let j = i; j <= limit; j++) {
        batch.push({
          employeeId: `emp-${j}`,
          name: `Colaborador ${j}`,
          department: departments[j % departments.length],
          baseSalary: 8000 + (j % 15000),
          bonus: 1000 + (j % 3000),
          taxProfile: { inssRate: 0.11, irrfRate: 0.275 }
        });
      }

      // ordered: false permite ao Mongo inserir documentos em paralelo sem parar se um falhar
      await Employee.insertMany(batch, { ordered: false });
      inserted += batch.length;
    }

    return inserted;
  },

  // Retorna um Cursor nativo do MongoDB (Stream sob demanda, não carrega tudo na RAM!)
  getAllAsCursor() {
    return Employee.find().lean().cursor();
  },

  // Tenta registrar o evento atomicamente. Se der erro de chave duplicada (11000), já foi processado!
  async tryLockEvent(eventId) {
    try {
      await ProcessedEvent.create({ eventId });
      return true; // Conseguiu registrar agora (primeira vez)
    } catch (err) {
      if (err.code === 11000) return false; // Duplicate Key Error -> Já processado!
      throw err;
    }
  }
};