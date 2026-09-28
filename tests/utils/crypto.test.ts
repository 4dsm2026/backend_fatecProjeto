import { describe, it, expect } from 'vitest'
import { hashValue, verifyHash } from '../../src/utils/crypto'
import { verify } from 'crypto'


describe('Crypto utils', () => {
    it ('gera o mesmo hash para o mesmo valor', () =>{
        const hash1 = hashValue('token-123')
        const hash2 = hashValue('token-123')

        expect(hash1).toBe(hash2)
    })

    it ('Gera valores diferentes para o mesmo hash', () =>{
        const hash1 = hashValue('token-123')
        const hash2 = hashValue('token-456')

        expect(hash1).not.toBe(hash2)
    })

    it ('retorna true quando o valor bate com o hash', () =>{
        const hash = hashValue('token-123')

        const resultado = verifyHash('token-123', hash)

        expect(resultado).toBe(true)
    })
    
        it ('retorna false quando o valor não bate com hash', () =>{
        const hash = hashValue('token-123')

        const resultado = verifyHash('token-456', hash)

        expect(resultado).toBe(false)
    })

})


/* 
    it ('', () =>{        
    })
*/