import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/core/anexos/anexos.controller', () => ({
    list: vi.fn(),
    upload: vi.fn(),
    download: vi.fn(),
    generateDownloadTokenRoute: vi.fn(),
}));

import { anexoRoutes } from '../../../src/core/anexos/anexos.routes';

describe('AnexosRoutes', () => {

    let app: any;

    beforeEach(() => {
        app = {
            addHook: vi.fn(),
            get: vi.fn(),
            post: vi.fn(),
            authenticate: vi.fn(),
        };
    });

    describe('registro das rotas', () => {
    it('deve registrar o hook de autenticação', async () => {
    await anexoRoutes(app);

    expect(app.addHook).toHaveBeenCalledWith(
        'preHandler',
        app.authenticate
    );
});

        it('deve registrar a rota de listagem de anexos', async () => {
    await anexoRoutes(app);

    expect(app.get).toHaveBeenCalledWith(
        '/tickets/:id/anexos',
        expect.any(Function)
    );
});

        it('deve registrar a rota de upload de anexos', async () => {
    await anexoRoutes(app);

    expect(app.post).toHaveBeenCalledWith(
        '/tickets/:id/anexos',
        expect.any(Function)
    );
});

        it('deve registrar a rota de download de anexos', async () => {
    await anexoRoutes(app);

    expect(app.get).toHaveBeenCalledWith(
        '/anexos/:anexoId/download',
        expect.any(Function)
    );
});

        it('deve registrar a rota de geração de token de download', async () => {
    await anexoRoutes(app);

    expect(app.post).toHaveBeenCalledWith(
        '/anexos/:anexoId/download-token',
        expect.any(Function)
    );
});

        it('deve encaminhar a rota de geração de token para generateDownloadTokenRoute', async () => {
    await anexoRoutes(app);

    const rotaToken = app.post.mock.calls.find(
        (call: any[]) => call[0] === '/anexos/:anexoId/download-token'
    )[1];

    const req = { user: { sub: 'user-123' } };
    const res = {};

    const { generateDownloadTokenRoute } =
        await import('../../../src/core/anexos/anexos.controller');

    await rotaToken(req, res);

    expect(generateDownloadTokenRoute).toHaveBeenCalledWith(req, res);
});

        it('deve registrar as quatro rotas de anexos com os métodos HTTP corretos', async () => {
    await anexoRoutes(app);

    expect(app.get).toHaveBeenCalledTimes(2);
    expect(app.post).toHaveBeenCalledTimes(2);

    expect(app.get).toHaveBeenCalledWith(
        '/tickets/:id/anexos',
        expect.any(Function)
    );

    expect(app.get).toHaveBeenCalledWith(
        '/anexos/:anexoId/download',
        expect.any(Function)
    );

    expect(app.post).toHaveBeenCalledWith(
        '/tickets/:id/anexos',
        expect.any(Function)
    );

    expect(app.post).toHaveBeenCalledWith(
        '/anexos/:anexoId/download-token',
        expect.any(Function)
    );
});

    });
});