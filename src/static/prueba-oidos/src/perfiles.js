// Perfiles de audifono: como pasar de dBFS (lo que genera el navegador) a dB HL estimados.
//
//   dB HL = dBFS + desfase[frecuencia]
//
// Hoy todos los desfases son PROVISIONALES: salen de suponer que el audifono, con el volumen del
// celular al maximo, da SALIDA_MAX dB SPL con un tono a 0 dBFS, menos el umbral de referencia
// (RETSPL) de ISO 389-1 para audifono supra-aural. No hay audiometro para medirlos: se van a
// recalcular con la poblacion (mediana de menores de 30 sin antecedentes auditivos = 0-5 dB HL,
// por perfil). Por eso cada prueba guarda los dBFS crudos ademas del HL.
//
// Cambiar un desfase = subir VERSION_CALIBRACION, para no mezclar resultados de calibraciones
// distintas en el analisis.
export const VERSION_CALIBRACION = 'provisional-1';

// ISO 389-1, TDH-39 (dB SPL en 0 dB HL)
const RETSPL = { 250: 25.5, 500: 11.5, 1000: 7, 2000: 9, 3000: 10, 4000: 9.5, 6000: 15.5, 8000: 13 };

function desfases(salidaMax) {
    return Object.fromEntries(Object.entries(RETSPL).map(([f, r]) => [f, salidaMax - r]));
}

export const PERFILES = [
    { id: 'cable', nombre: 'De cable', detalle: 'Audífonos con cable al celular', bluetooth: false, desfase: desfases(100) },
    { id: 'airpods', nombre: 'AirPods', detalle: 'Cualquier modelo de AirPods', bluetooth: true, desfase: desfases(100) },
    { id: 'galaxy-buds', nombre: 'Galaxy Buds', detalle: 'Audífonos Samsung inalámbricos', bluetooth: true, desfase: desfases(100) },
    { id: 'diadema', nombre: 'De diadema', detalle: 'Grandes, sobre las orejas', bluetooth: null, desfase: desfases(100) },
    { id: 'bluetooth', nombre: 'Otros inalámbricos', detalle: 'Bluetooth de otra marca', bluetooth: true, desfase: desfases(95) },
];

export const perfilPorId = (id) => PERFILES.find((p) => p.id === id) || null;

export function aDbfs(hl, frecuencia, perfil) {
    return hl - perfil.desfase[frecuencia];
}

export function aHL(dbfs, frecuencia, perfil) {
    return dbfs + perfil.desfase[frecuencia];
}
