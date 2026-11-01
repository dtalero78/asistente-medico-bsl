// Casos de prueba de umbral.js y resultado.js. Sin DOM: los corre pruebas/unidad.html en el
// navegador y tambien node (`node pruebas/node.mjs`).
import { crearUmbral } from '../src/umbral.js';
import { pta4, gradoOMS, asimetria, caidaAgudos, confiabilidad, resumir, valorPromediable } from '../src/resultado.js';
import { PERFILES, aDbfs, aHL } from '../src/perfiles.js';

// Generador con semilla: los casos simulados dan siempre lo mismo
function mulberry32(a) {
    return () => {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Oyente con curva psicometrica logistica: umbral T (50 %), pendiente s, falsos positivos y despistes
function oyente(T, rnd, { s = 2, fp = 0.02, despiste = 0.02 } = {}) {
    return (nivel) => rnd() < fp + (1 - fp - despiste) / (1 + Math.exp(-(nivel - T) / s));
}

function simular(T, rnd, op = {}) {
    const u = crearUmbral({ inicio: op.inicio ?? 40, piso: 0, techo: 70 });
    const oye = oyente(T, rnd, op);
    while (!u.terminado) u.responder(oye(u.siguiente()));
    return u.resultado();
}

const plano = (v) => Object.fromEntries([500, 1000, 2000, 3000, 4000, 6000].map((f) => [f, { hl: v, estado: 'ok' }]));
const conValores = (vals) => Object.fromEntries(Object.entries(vals).map(([f, v]) => [f, { hl: v, estado: 'ok' }]));
const sinProblemas = {
    falsos: { control: 10, contestados: 0, espontaneos: 0, ensayos: 100 },
    retest: { primero: 10, segundo: 10 }, ruido: { antes: -75, despues: -74 },
    lateralidad: 'ok', parlante: false, perfil: { bluetooth: false }, techo: 70,
};

export function correr({ grupo, comprobar }) {
    const cerca = (a, b, tol) => a != null && Math.abs(a - b) <= tol;

    // ------------------------------------------------------------ umbral.js
    grupo('umbral.js — oyente perfecto');
    {
        // Oye todo lo >= 23: 40 si, 30 si, 20 no, 25 si (sube), 15 no, 20 no, 25 si (sube) -> 25
        const u = crearUmbral({ inicio: 40, piso: 0, techo: 70 });
        while (!u.terminado) u.responder(u.siguiente() >= 23);
        const r = u.resultado();
        comprobar('umbral 23 → 25 dB', r.umbral === 25 && r.estado === 'ok', JSON.stringify(r.historial.map((h) => h.nivel)));
        comprobar('en 7 ensayos', r.ensayos === 7, r.ensayos);
    }
    {
        const u = crearUmbral({ inicio: 40, piso: 0, techo: 70 });
        while (!u.terminado) u.responder(true);
        comprobar('oye todo → piso', u.resultado().estado === 'piso' && u.resultado().umbral === 0, JSON.stringify(u.resultado()));
    }
    {
        const u = crearUmbral({ inicio: 40, piso: 0, techo: 70 });
        while (!u.terminado) u.responder(false);
        const r = u.resultado();
        comprobar('no oye nada → sin respuesta', r.estado === 'sin-respuesta' && r.umbral === null, JSON.stringify(r));
        comprobar('sube de a 10 hasta el techo', r.historial.map((h) => h.nivel).join() === '40,50,60,70,70', r.historial.map((h) => h.nivel).join());
    }
    {
        // Responde al azar: no debe quedarse para siempre
        const rnd = mulberry32(7);
        const u = crearUmbral({ inicio: 40, piso: 0, techo: 70, maxEnsayos: 24 });
        while (!u.terminado) u.responder(rnd() < 0.5);
        comprobar('azar termina en <= 24 ensayos', u.resultado().ensayos <= 24, u.resultado().ensayos);
    }

    grupo('umbral.js — oyente simulado (300 corridas por umbral)');
    const rnd = mulberry32(42);
    for (const T of [5, 12, 20, 33, 47, 60]) {
        const corridas = Array.from({ length: 300 }, () => simular(T, rnd));
        const conUmbral = corridas.filter((r) => r.umbral != null);
        const errores = conUmbral.map((r) => r.umbral - T);
        const medio = errores.reduce((a, b) => a + b, 0) / errores.length;
        // Con escalones de 5 dB un umbral real de 33 sale 35 o 40: ±5 depende de donde caiga la
        // rejilla. La meta es la de Mimi, ±10 dB; ±5 queda como referencia.
        const dentro5 = errores.filter((e) => Math.abs(e) <= 5).length / errores.length;
        const dentro10 = errores.filter((e) => Math.abs(e) <= 10).length / errores.length;
        const ensayos = corridas.reduce((a, r) => a + r.ensayos, 0) / corridas.length;
        comprobar(`T=${T}: sesgo medio ${medio.toFixed(1)} dB (|sesgo| <= 3)`, Math.abs(medio) <= 3, medio.toFixed(2));
        comprobar(`T=${T}: ${(dentro10 * 100).toFixed(0)} % dentro de ±10 dB (>= 95 %)`, dentro10 >= 0.95, dentro10.toFixed(2));
        comprobar(`T=${T}: ${(dentro5 * 100).toFixed(0)} % dentro de ±5 dB (>= 80 %)`, dentro5 >= 0.8, dentro5.toFixed(2));
        // Arranca en 40: lejos del umbral cuesta mas. En la prueba arranca cerca de la frecuencia anterior
        comprobar(`T=${T}: ${ensayos.toFixed(1)} ensayos en promedio (<= 14)`, ensayos <= 14, ensayos.toFixed(1));
    }
    {
        const corridas = Array.from({ length: 200 }, () => simular(85, rnd));
        const sin = corridas.filter((r) => r.estado === 'sin-respuesta').length / corridas.length;
        comprobar(`T=85 (sobre el techo): ${(sin * 100).toFixed(0)} % sin respuesta (>= 90 %)`, sin >= 0.9, sin);
    }
    {
        const corridas = Array.from({ length: 200 }, () => simular(-8, rnd));
        const piso = corridas.filter((r) => r.estado === 'piso').length / corridas.length;
        comprobar(`T=-8 (bajo el piso): ${(piso * 100).toFixed(0)} % en piso (>= 90 %)`, piso >= 0.9, piso);
    }
    {
        // Oyente descuidado: 20 % de falsos positivos sigue dando algo cerca
        const corridas = Array.from({ length: 300 }, () => simular(30, rnd, { fp: 0.2 }));
        const errores = corridas.filter((r) => r.umbral != null).map((r) => r.umbral - 30);
        const medio = errores.reduce((a, b) => a + b, 0) / errores.length;
        comprobar(`fp 20 %: sesgo medio ${medio.toFixed(1)} dB (empuja hacia abajo, <= 8)`, Math.abs(medio) <= 8, medio.toFixed(2));
    }

    // ------------------------------------------------------------ perfiles.js
    grupo('perfiles.js');
    {
        const p = PERFILES[0];
        comprobar('ida y vuelta HL ↔ dBFS', cerca(aHL(aDbfs(25, 4000, p), 4000, p), 25, 1e-9));
        comprobar('0 dB HL en 1 kHz ≈ -93 dBFS (cable)', cerca(aDbfs(0, 1000, p), -93, 1e-9), aDbfs(0, 1000, p));
        comprobar('todos los perfiles tienen las 6 frecuencias', PERFILES.every((x) => [500, 1000, 2000, 3000, 4000, 6000].every((f) => Number.isFinite(x.desfase[f]))));
    }

    // ------------------------------------------------------------ resultado.js
    grupo('resultado.js — PTA4 y grado OMS');
    comprobar('PTA4 de 10/20/30/40', pta4(conValores({ 500: 10, 1000: 20, 2000: 30, 4000: 40 }), 70) === 25);
    comprobar('PTA4 con una frecuencia faltante es null', pta4(conValores({ 500: 10, 1000: 20, 2000: 30 }), 70) === null);
    comprobar('sin respuesta cuenta techo + 5', valorPromediable({ hl: null, estado: 'sin-respuesta' }, 70) === 75);
    comprobar('grado 19.9 normal', gradoOMS(19.9) === 'normal');
    comprobar('grado 20 leve', gradoOMS(20) === 'leve');
    comprobar('grado 34.9 leve / 35 moderada', gradoOMS(34.9) === 'leve' && gradoOMS(35) === 'moderada');
    comprobar('grado 95 completa', gradoOMS(95) === 'completa');

    grupo('resultado.js — asimetría y caída en agudos');
    {
        const od = conValores({ 500: 10, 1000: 10, 2000: 10, 3000: 35, 4000: 40, 6000: 30 });
        const oi = plano(10);
        const a = asimetria(od, oi, 70);
        comprobar('asimetría en 3k-4k-6k, peor el derecho', a.presente && a.peorOido === 'od', JSON.stringify(a));
        comprobar('una sola frecuencia distinta no es asimetría',
            !asimetria(conValores({ 500: 10, 1000: 10, 2000: 30, 3000: 10, 4000: 10, 6000: 10 }), oi, 70).presente);
        const c = caidaAgudos(od, 70);
        comprobar('caída en agudos de 25 dB en el derecho', c.presente && c.diferencia === 25, JSON.stringify(c));
        comprobar('agudos peores pero bajo 25 dB HL no cuenta',
            !caidaAgudos(conValores({ 500: 0, 1000: 0, 2000: 0, 3000: 20, 4000: 20, 6000: 20 }), 70).presente);
    }

    grupo('resultado.js — confiabilidad');
    {
        const base = { od: plano(10), oi: plano(10), ptaOd: 10, ptaOi: 10, ...sinProblemas };
        comprobar('todo bien → confiable', confiabilidad(base).nivel === 'confiable', JSON.stringify(confiabilidad(base)));
        comprobar('3 de 10 silencios contestados → no confiable',
            confiabilidad({ ...base, falsos: { ...base.falsos, contestados: 3 } }).nivel === 'no-confiable');
        comprobar('1 de 10 silencios → dudosa',
            confiabilidad({ ...base, falsos: { ...base.falsos, contestados: 1 } }).nivel === 'dudosa');
        comprobar('1 kHz repetido 20 dB distinto → no confiable',
            confiabilidad({ ...base, retest: { primero: 10, segundo: 30 } }).nivel === 'no-confiable');
        comprobar('parlante → no confiable', confiabilidad({ ...base, parlante: true }).nivel === 'no-confiable');
        comprobar('lateralidad fallida → no confiable', confiabilidad({ ...base, lateralidad: 'fallo' }).nivel === 'no-confiable');
        comprobar('ruido -55 dBFS → dudosa', confiabilidad({ ...base, ruido: { antes: -55, despues: -70 } }).nivel === 'dudosa');
        comprobar('sin medida de ruido → dudosa', confiabilidad({ ...base, ruido: null }).nivel === 'dudosa');
        const plana = { ...base, od: plano(40), oi: plano(45), ptaOd: 40, ptaOi: 45 };
        comprobar('curva plana alta en los dos oídos → dudosa (volumen bajo)', confiabilidad(plana).nivel === 'dudosa', JSON.stringify(confiabilidad(plana)));
        comprobar('Bluetooth solo deja una nota', confiabilidad({ ...base, perfil: { bluetooth: true } }).nivel === 'confiable');
        comprobar('1 corrección no cambia nada', confiabilidad({ ...base, correcciones: 1 }).nivel === 'confiable');
        comprobar('2 correcciones → dudosa', confiabilidad({ ...base, correcciones: 2 }).nivel === 'dudosa');
        comprobar('ruido solo (sin tocar sin pitido) no marca conducta', !confiabilidad({ ...base, ruido: { antes: -55, despues: null } }).conducta);
        comprobar('2 pausas por inactividad → dudosa', confiabilidad({ ...base, pausas: 2 }).nivel === 'dudosa');
    }

    grupo('resultado.js — veredicto');
    {
        const base = { od: plano(10), oi: plano(10), ...sinProblemas };
        comprobar('normal → pasa', resumir(base).veredicto === 'pasa');
        const caida = { ...base, od: conValores({ 500: 10, 1000: 10, 2000: 10, 3000: 35, 4000: 45, 6000: 40 }) };
        comprobar('caída en agudos → remitir', resumir(caida).veredicto === 'remitir');
        comprobar('no confiable → repetir', resumir({ ...base, parlante: true }).veredicto === 'repetir');
        // Corrida real del simulador (tramposo, 1 toque al azar cada ~7 s): escondio una muesca de 45 dB
        // y antes salia "pasa" con confiabilidad "dudosa"
        const tramposo = {
            ...base,
            od: conValores({ 500: 15, 1000: 15, 2000: 20, 3000: 20, 4000: 20, 6000: 40 }),
            oi: conValores({ 500: 15, 1000: 15, 2000: 15, 3000: 15, 4000: 25, 6000: 10 }),
            falsos: { control: 22, contestados: 4, espontaneos: 43, ensayos: 215 }, correcciones: 3, pausas: 1,
        };
        comprobar('tramposo real → no confiable y repetir', resumir(tramposo).veredicto === 'repetir'
            && resumir(tramposo).confiabilidad.nivel === 'no-confiable', JSON.stringify(resumir(tramposo).confiabilidad));
        comprobar('pocos toques sueltos y normal → repetir, no pasa',
            resumir({ ...base, falsos: { ...base.falsos, espontaneos: 10, ensayos: 100 } }).veredicto === 'repetir');
        comprobar('toques sueltos y alterado → sigue en remitir',
            resumir({ ...caida, falsos: { ...base.falsos, espontaneos: 10, ensayos: 100 } }).veredicto === 'remitir');
        comprobar('3 correcciones → no confiable', confiabilidad({ ...base, ptaOd: 10, ptaOi: 10, correcciones: 3 }).nivel === 'no-confiable');
    }
}
