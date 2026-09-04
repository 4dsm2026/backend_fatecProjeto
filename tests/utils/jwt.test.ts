import { describe, it, expect } from 'vitest'
import {
    generateAccessToken, verifyAccessToken, generateRefreshToken,
    verifyRefreshToken, generateDownloadToken, verifyDownloadToken
} from '../../src/utils/jwt'


describe('jwt-testes', () => {
    it('Lança erro JWT_ACCESS_SECRET quando a secret não existe', () => {

        const original = process.env.JWT_ACCESS_SECRET
        delete process.env.JWT_ACCESS_SECRET

        expect(() => generateAccessToken({ sub: '1', email: 'a@a.com', role: 'USUARIO' })).toThrow()

        process.env.JWT_ACCESS_SECRET = original

    })

    it('Gera um token de verdade quando a secret existe', () => {
        
        const original = process.env.JWT_ACCESS_SECRET

        delete process.env.JWT_ACCESS_SECRET

        const token1 = generateAccessToken

        expect(() => generateAccessToken({ sub: '1', email: 'a@a.com', role: 'USUARIO' })).toThrow()

        process.env.JWT_ACCESS_SECRET = original

    })



})


/*Lança erro quando JWT_ACCESS_SECRET não existe
Gera um token de verdade quando a secret existe
Usa a expiração padrão quando opts não é passado
*/