// Casos de la prueba visual, sin DOM ni cámara. Corren en la terminal (node pruebas/node.mjs).
import {
    distanciaMm, estadoDistancia, escalaSinCalibrar, niveles, crearEscalera, rectangulosE,
    DIRECCIONES, PX_POR_MM_CELULAR, IRIS_MM, distanciaDePrueba, RANGO_DISTANCIA, LOGMAR_CORTE,
} from '../src/agudeza.js';
import {
    LAMINAS, PROTAN, DEUTAN, CONFUSION, coloresDeLamina, multiplicar, deltaE, puntosDeLamina, aLineal,
    evaluarColores, azarConSemilla, NINGUNO,
} from '../src/colores.js';
import { concepto } from '../src/resultado.js';
import { textura, regionOjo, referencia, estadoOclusion, OCLUSION } from '../src/oclusion.js';

// Imagen sintética de 80×50: un ojo (blanco + iris oscuro + pupila, con pestañas) o una palma lisa
function imagen(fn, w = 80, h = 50) {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const [r, g, b] = fn(x, y), i = (y * w + x) * 4;
        data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
    return { data, width: w, height: h };
}
const piel = [200, 150, 120];
const ojoAbierto = (luz = 1) => imagen((x, y) => {
    const dx = (x - 40) / 30, dy = (y - 25) / 12, d = Math.hypot(x - 40, y - 25);
    let c = piel;
    if (dx * dx + dy * dy < 1) c = d < 4 ? [15, 15, 15] : d < 10 ? [90, 60, 40] : [235, 230, 225];
    if (Math.abs(dy + 1) < 0.12 && Math.abs(dx) < 1 && x % 3 === 0) c = [40, 30, 25];   // pestañas
    return c.map((v) => Math.min(255, v * luz));
});
const palma = (luz = 1) => imagen((x, y) => {
    const t = Math.hypot(x - 40, y - 25) / 47;
    return [216 - 25 * t, 169 - 25 * t, 138 - 26 * t].map((v) => v * luz);
});

export function correr({ grupo, comprobar }) {
    grupo('Distancia y escala');
    {
        // A 40 cm una cámara de ~55° abarca ~42 cm: el iris (11.7 mm) son ~20 px de 720
        const mm = distanciaMm(20, 720, 1280);
        comprobar('a ~40 cm un iris de 20 px en 720 px de ancho (cámara de celular)', mm > 360 && mm < 440, mm.toFixed(0));
        comprobar('el doble de iris = la mitad de distancia', Math.abs(distanciaMm(40, 720, 1280) - mm / 2) < 1);
        comprobar('estado: cerca / bien / lejos',
            estadoDistancia(300) === 'cerca' && estadoDistancia(400) === 'bien' && estadoDistancia(520) === 'lejos');
        comprobar('celular sin calibrar: 6 px/mm', escalaSinCalibrar({ ancho: 390, alto: 844, tactil: true }) === PX_POR_MM_CELULAR);
        comprobar('computador: hay que calibrar', escalaSinCalibrar({ ancho: 1440, alto: 900, tactil: false }) === null);
        comprobar('IRIS_MM es 11.7', IRIS_MM === 11.7);
    }

    grupo('Niveles de la E');
    {
        const lista = niveles(6, 3);   // celular de 3x
        comprobar('hay niveles de 20/200 a ~20/20', lista.length >= 9 && lista[0].logMAR >= 0.95 && lista.at(-1).logMAR <= 0.05,
            lista.map((n) => n.snellen).join(' '));
        comprobar('trazos enteros, ≥ 2 px y cada nivel más chico que el anterior',
            lista.every((n, i) => Number.isInteger(n.trazo) && n.trazo >= 2 && (i === 0 || n.trazo < lista[i - 1].trazo)));
        // En cualquier pantalla el corte 20/40 se puede medir EXACTO, a una distancia razonable
        const pantallas = [
            ['celular 3x', 6, 3, 'celular'], ['celular 2x', 6, 2, 'celular'], ['celular 2,625x', 6, 2.625, 'celular'],
            ['computador 1x', 3.78, 1, 'computador'], ['computador 1,25x', 4.5, 1.25, 'computador'],
            ['computador 2x (retina)', 4.4, 2, 'computador'], ['monitor 27" 1440p', 4.29, 1, 'computador'],
            ['computador 1,5x', 3.78, 1.5, 'computador'],
        ];
        for (const [nombre, pxmm, dpr, tipo] of pantallas) {
            const d = distanciaDePrueba(pxmm, dpr, tipo);
            const lista = niveles(pxmm, dpr, d);
            const corte = lista.find((n) => Math.abs(n.logMAR - LOGMAR_CORTE) <= 0.01);
            const [min, max] = RANGO_DISTANCIA[tipo];
            comprobar(`${nombre}: 20/40 exacto a ${Math.round(d / 10)} cm (dentro de ${min / 10}-${max / 10})`,
                corte && d >= min && d <= max, `${d} mm, niveles: ${lista.map((n) => n.snellen).join(' ')}`);
        }
        // Pantallas donde ningún entero cae en el rango: el nivel más cercano a 20/40 sin pasarse,
        // y nunca un nivel más laxo que el corte como el único disponible
        for (const [nombre, pxmm, dpr, tipo] of [['celular 1x', 6, 1, 'celular'], ['celular 1,75x', 6, 1.75, 'celular'], ['computador 1,25x', 3.78, 1.25, 'computador']]) {
            const d = distanciaDePrueba(pxmm, dpr, tipo);
            const lista = niveles(pxmm, dpr, d);
            const [min, max] = RANGO_DISTANCIA[tipo];
            const cerca = Math.max(...lista.filter((n) => n.logMAR <= LOGMAR_CORTE + 1e-9).map((n) => n.logMAR));
            comprobar(`${nombre}: a ${Math.round(d / 10)} cm hay un nivel entre 20/32 y 20/40 (${cerca})`,
                d >= min && d <= max && cerca >= 0.2 && cerca <= LOGMAR_CORTE + 1e-9, `${d} mm, niveles: ${lista.map((n) => n.snellen).join(' ')}`);
        }
    }

    grupo('La E');
    {
        const abierta = (d) => {
            // la columna/fila del lado hacia donde apunta queda con huecos (las patas)
            const celdas = new Set();
            for (const [x, y, w, h] of rectangulosE(d)) for (let i = x; i < x + w; i++) for (let j = y; j < y + h; j++) celdas.add(`${i},${j}`);
            const borde = { derecha: (k) => `4,${k}`, izquierda: (k) => `0,${k}`, abajo: (k) => `${k},4`, arriba: (k) => `${k},0` }[d];
            const llenas = [0, 1, 2, 3, 4].filter((k) => celdas.has(borde(k))).length;
            return { llenas, total: celdas.size };
        };
        for (const d of DIRECCIONES) {
            const r = abierta(d);
            comprobar(`E hacia ${d}: 3 patas en ese borde y 17 celdas`, r.llenas === 3 && r.total === 17, JSON.stringify(r));
        }
    }

    grupo('Escalera (pacientes simulados)');
    {
        const lista = niveles(6, 3);
        const simular = (verdadera, semilla) => {
            const azar = azarConSemilla(semilla);
            const esc = crearEscalera(lista, azar);
            let n = 0;
            while (!esc.terminado && n++ < 80) {
                const e = esc.siguiente();
                // Curva psicométrica: 25 % al azar (4 direcciones), 62 % en su umbral, ~98 % una línea arriba
                const margen = e.nivel.logMAR - verdadera;
                const p = 0.25 + 0.75 / (1 + Math.exp(-margen / 0.03));
                const respuesta = azar() < p ? e.direccion : DIRECCIONES.find((d) => d !== e.direccion);
                esc.responder(e, respuesta);
            }
            return { r: esc.resultado(), ensayos: esc.ensayos.length };
        };
        // Los niveles salen de px enteros: en un celular de 3x a 40 cm abajo solo hay 20/29 y 20/19.
        // "Cerca" = a lo sumo un nivel de la pantalla de distancia del nivel más próximo a la real.
        const indice = (v) => lista.reduce((m, n, k) => (Math.abs(n.logMAR - v) < Math.abs(lista[m].logMAR - v) ? k : m), 0);
        for (const verdadera of [0.0, 0.2, 0.4, 0.7]) {
            let cerca = 0, ensayos = 0, error = 0;
            for (let s = 1; s <= 200; s++) {
                const { r, ensayos: e } = simular(verdadera, s * 7919 + verdadera * 1000);
                ensayos += e;
                if (r.logMAR != null) {
                    if (Math.abs(indice(r.logMAR) - indice(verdadera)) <= 1) cerca++;
                    error += Math.abs(r.logMAR - verdadera);
                }
            }
            comprobar(`agudeza real ${verdadera}: ≥ 85 % de las veces a un nivel o menos`, cerca >= 170, `${cerca}/200`);
            comprobar(`agudeza real ${verdadera}: error medio ≤ 0.12 logMAR`, error / 200 <= 0.12, (error / 200).toFixed(3));
            comprobar(`agudeza real ${verdadera}: pocas E por ojo (≤ 30 en promedio)`, ensayos / 200 <= 30, (ensayos / 200).toFixed(1));
        }
        {
            // Alguien que no ve nada: no aprueba ni 20/200
            const esc = crearEscalera(lista, azarConSemilla(3));
            while (!esc.terminado) { const e = esc.siguiente(); esc.responder(e, 'no-veo'); }
            const r = esc.resultado();
            comprobar('si no ve ni la más grande: logMAR null y "peor que 20/200"', r.logMAR === null && r.peorQue === lista[0].snellen, JSON.stringify(r));
        }
        {
            // Las 4 direcciones por igual (adivinar = 1 de 4) y nunca 3 iguales seguidas
            const cuenta = { arriba: 0, abajo: 0, izquierda: 0, derecha: 0 };
            let triple = false;
            for (let s = 1; s <= 60; s++) {
                const esc = crearEscalera(lista, azarConSemilla(s));
                const vistas = [];
                while (!esc.terminado) { const e = esc.siguiente(); vistas.push(e.direccion); cuenta[e.direccion]++; esc.responder(e, e.direccion); }
                if (vistas.some((d, i) => i >= 2 && d === vistas[i - 1] && d === vistas[i - 2])) triple = true;
            }
            const total = Object.values(cuenta).reduce((a, b) => a + b, 0);
            comprobar('nunca 3 veces seguidas la misma dirección', !triple);
            comprobar('cada dirección sale ~1 de 4 (20-30 %)', Object.values(cuenta).every((c) => c / total >= 0.2 && c / total <= 0.3), JSON.stringify(cuenta));
        }
    }

    grupo('Láminas de colores');
    {
        for (const l of LAMINAS.filter((x) => x.tipo !== 'demo')) {
            const { figura, fondo } = coloresDeLamina(l);
            const enGama = [...figura, ...fondo].every((v) => v >= 0 && v * 1.16 <= 1);
            const normal = deltaE(figura, fondo);
            const m = l.tipo === 'protan' ? PROTAN : DEUTAN;
            const simulado = deltaE(multiplicar(m, figura), multiplicar(m, fondo));
            const minimo = l.fuerza === 'fuerte' ? 40 : 20;
            comprobar(`${l.id} (${l.tipo} ${l.fuerza}): en gama`, enGama);
            comprobar(`${l.id}: quien ve bien la distingue (ΔE ≥ ${minimo})`, normal >= minimo, normal.toFixed(1));
            comprobar(`${l.id}: el ${l.tipo} simulado no (ΔE < 1)`, simulado < 1, simulado.toFixed(2));
            // Alteración leve (severidad ~0.6): queda bajo el ruido de brillo en las suaves
            if (l.fuerza === 'suave') {
                const leve = deltaE(figura.map((v, i) => 0.4 * v + 0.6 * multiplicar(m, figura)[i]), fondo.map((v, i) => 0.4 * v + 0.6 * multiplicar(m, fondo)[i]));
                comprobar(`${l.id}: con una alteración leve la diferencia es pequeña (ΔE < 12)`, leve < 12, leve.toFixed(1));
            }
        }
        {
            const { figura, fondo } = coloresDeLamina(LAMINAS[0]);
            const todos = [deltaE(figura, fondo), deltaE(multiplicar(PROTAN, figura), multiplicar(PROTAN, fondo)), deltaE(multiplicar(DEUTAN, figura), multiplicar(DEUTAN, fondo))];
            comprobar('la de ejemplo la lee todo el mundo (ΔE ≥ 40 en los tres)', todos.every((v) => v >= 40), todos.map((v) => v.toFixed(0)).join(' / '));
        }
        comprobar('vectores de confusión unitarios',
            Object.values(CONFUSION).every((d) => Math.abs(Math.hypot(...d) - 1) < 0.01));
        {
            const enFigura = (x) => x > 0;   // media lámina
            const a = puntosDeLamina(LAMINAS[1], enFigura, 42, 500), b = puntosDeLamina(LAMINAS[1], enFigura, 42, 500);
            comprobar('misma semilla = misma lámina', JSON.stringify(a) === JSON.stringify(b));
            comprobar('los puntos no se tocan y caben en el círculo',
                a.every((p, i) => Math.hypot(p.x, p.y) <= 1 - p.r + 1e-9 && a.every((q, j) => i === j || Math.hypot(p.x - q.x, p.y - q.y) >= p.r + q.r)));
            comprobar('se llena bien el círculo (≥ 400 puntos)', a.length >= 400, a.length);
            // A quien no distingue rojo/verde el brillo tampoco le delata la figura: en su vista
            // simulada, figura y fondo tienen el mismo brillo medio
            const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
            const media = (ps) => ps.reduce((s, p) => s + lum(multiplicar(PROTAN, aLineal(p.color))), 0) / ps.length;
            const dentro = media(a.filter((p) => p.x > 0)), fuera = media(a.filter((p) => p.x <= 0));
            comprobar('protán simulado: mismo brillo medio en figura y fondo (≤ 0.01)', Math.abs(dentro - fuera) <= 0.01, `${dentro.toFixed(3)} vs ${fuera.toFixed(3)}`);
        }
    }

    grupo('Ojo tapado (por píxeles)');
    {
        const R = { x: 0, y: 0, w: 79, h: 49 };
        const abierto = textura(ojoAbierto(), R), mano = textura(palma(), R);
        comprobar('un ojo abierto tiene mucha más textura que una palma (×4 o más)', abierto > 4 * mano, `${abierto.toFixed(1)} vs ${mano.toFixed(1)}`);
        const oscuro = textura(ojoAbierto(0.4), R);
        comprobar('con poca luz el ojo sigue teniendo textura parecida (relativa al brillo)', oscuro > 0.6 * abierto, `${oscuro.toFixed(1)} vs ${abierto.toFixed(1)}`);
        const reg = regionOjo({ x: 100, y: 50 }, { x: 160, y: 50 });
        comprobar('la región sale de las comisuras (no de los párpados)', Math.round(reg.w) === 72 && Math.round(reg.h) === 43 && Math.round(reg.x) === 94);
        const muestras = Array.from({ length: 15 }, () => ({ OD: abierto, OI: abierto * 0.9 }));
        const ref = referencia(muestras);
        comprobar('referencia con 12+ muestras', ref && ref.OD === abierto);
        comprobar('sin muestras suficientes no hay referencia', referencia(muestras.slice(0, 5)) === null);
        comprobar('tapa el izquierdo → tapado', estadoOclusion(ref, { OD: abierto, OI: mano }, 'OI') === 'tapado');
        comprobar('no tapa nada → destapado', estadoOclusion(ref, { OD: abierto, OI: abierto }, 'OI') === 'destapado');
        comprobar('tapa el equivocado → otro', estadoOclusion(ref, { OD: mano, OI: abierto }, 'OI') === 'otro');
        comprobar('sin referencia → null', estadoOclusion(null, { OD: 1, OI: 1 }, 'OI') === null);
        comprobar('umbrales coherentes', OCLUSION.TAPADO < OCLUSION.ABIERTO && OCLUSION.ABIERTO < OCLUSION.DESTAPADO);
        // Reflejo de la pantalla en el lente: lavado y casi sin bordes, pero blanco
        const reflejo = imagen((x, y) => (Math.hypot(x - 40, y - 25) < 22 ? [252, 252, 250] : piel));
        comprobar('un reflejo en las gafas no cuenta (textura null, ni tapado ni destapado)', textura(reflejo, R) === null);
        comprobar('ni con poca luz la palma se toma por reflejo', textura(palma(0.5), R) !== null);
        // Se adelantó: ya tenía un ojo tapado al tomar la referencia
        const adelantado = Array.from({ length: 15 }, () => ({ OD: abierto, OI: mano }));
        comprobar('referencia con un ojo ya tapado → null', referencia(adelantado) === null);
        // Solo muestras válidas (a la distancia de la prueba)
        const mezcla = [...Array.from({ length: 15 }, () => ({ OD: 99, OI: 99, bien: false })), ...Array.from({ length: 15 }, () => ({ OD: abierto, OI: abierto, bien: true }))];
        comprobar('la referencia usa solo las muestras válidas', referencia(mezcla, (m) => m.bien).OD === abierto);
    }

    grupo('Lectura de colores');
    {
        const todas = Object.fromEntries(LAMINAS.map((l) => [l.id, l.numero]));
        comprobar('todo bien → normal', evaluarColores(todas).lectura === 'normal');
        const protan = { ...todas, p1: NINGUNO, p2: 3, p3: NINGUNO };
        const r = evaluarColores(protan);
        comprobar('falla las protán → alterada, tipo protán', r.lectura === 'alterada' && r.tipo === 'protan', JSON.stringify(r));
        // Una alteración leve deután falla solo la suave deután
        const leve = evaluarColores({ ...todas, d3: NINGUNO });
        comprobar('falla solo la suave de su tipo → dudosa, tipo deután', leve.lectura === 'dudosa' && leve.tipo === 'deutan', JSON.stringify(leve));
        comprobar('sin láminas suaves en la lista no sale todo «dudosa»',
            evaluarColores(todas, LAMINAS.filter((l) => l.fuerza !== 'suave')).lectura === 'normal');
        comprobar('cada lámina: 4 números distintos, el correcto entre ellos',
            LAMINAS.every((l) => l.opciones.length === 4 && new Set(l.opciones).size === 4 && l.opciones.includes(l.numero)));
        comprobar('falla la de ejemplo → no válida', evaluarColores({ ...todas, demo: 17 }).lectura === 'no-valida');
        comprobar('cuenta 6 láminas de prueba', evaluarColores(todas).total === 6 && evaluarColores(todas).correctas === 6);
    }

    grupo('Concepto');
    {
        const ojo = (logMAR, reloj = 'igual') => ({ logMAR, reloj });
        const bien = { lectura: 'normal' };
        comprobar('20/20 y 20/25 con colores normales → Normal', concepto({ OD: ojo(0), OI: ojo(0.1) }, bien).concepto === 'Normal');
        comprobar('un ojo 20/50 → Aceptable', concepto({ OD: ojo(0), OI: ojo(0.4) }, bien).concepto === 'Aceptable');
        comprobar('un ojo 20/100 → Revisión Sugerida', concepto({ OD: ojo(0.7), OI: ojo(0) }, bien).concepto === 'Revisión Sugerida');
        comprobar('reloj distinto → Aceptable con motivo', (() => { const r = concepto({ OD: ojo(0, 'distinto'), OI: ojo(0) }, bien); return r.concepto === 'Aceptable' && /astigmatismo/.test(r.motivos.join()); })());
        comprobar('2 líneas entre ojos → Aceptable', concepto({ OD: ojo(0), OI: ojo(0.2) }, bien).concepto === 'Aceptable');
        comprobar('colores alterados → Revisión Sugerida', concepto({ OD: ojo(0), OI: ojo(0) }, { lectura: 'alterada' }).concepto === 'Revisión Sugerida');
        comprobar('ojo sin medir → Revisión Sugerida', concepto({ OD: ojo(null), OI: ojo(0) }, bien).concepto === 'Revisión Sugerida');
        comprobar('agudeza decimal: 20/40 = 50 %', concepto({ OD: ojo(0.3), OI: ojo(0) }, bien).decimal.OD === 50);
        {
            // Pantalla de muy baja densidad: su piso (20/56) está por encima del corte y lo leyó
            const r = concepto({ OD: { ...ojo(0.45), limiteDePantalla: true }, OI: { ...ojo(0.45), limiteDePantalla: true } }, bien);
            comprobar('el piso de la pantalla por encima del corte no castiga: Normal con motivo', r.concepto === 'Normal' && /pantalla/.test(r.motivos.join()), JSON.stringify(r));
        }
        {
            const r = concepto({ OD: { ...ojo(0), distanciaControlada: false, oclusionVerificada: false }, OI: ojo(0) }, bien);
            comprobar('distancia u oclusión sin controlar: motivo para el médico, sin cambiar el concepto',
                r.concepto === 'Normal' && r.motivos.some((m) => /distancia/.test(m)) && r.motivos.some((m) => /tapado/.test(m)), JSON.stringify(r.motivos));
        }
    }
}
