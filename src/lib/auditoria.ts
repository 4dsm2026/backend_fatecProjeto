import { prisma } from "./prisma";

// Modifique temporariamente a função registrarAuditoria:
export async function registrarAuditoria({
    feitoPorId,
    acao,
    alvo = null,
    meta = null,
}: {
    feitoPorId?: string | null;
    acao: string;
    alvo?: string | null;
    meta?: any;
}) {
    try {
        console.log('🎯 Registrando auditoria:', { acao, feitoPorId, alvo, meta });

        const result = await prisma.auditoria.create({
            data: {
                feitoPorId: feitoPorId || null,
                acao,
                alvo,
                meta,
            },
        });

        console.log('✅ Auditoria registrada com ID:', result.id);
        return result;
    } catch (error) {
        console.error("❌ Erro ao registrar auditoria:", error);
        throw error; // Opcional: remove o throw se quiser silencioso
    }
}
