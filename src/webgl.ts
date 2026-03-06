import { ColorList } from './types.ts';
import { paletteToRGBA } from './palette.ts';

export type Defines = Record<string, number | false>;

export function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile error:\n${log}`);
  }
  return shader;
}

export function buildProgram(
  gl: WebGL2RenderingContext,
  defines: Defines,
  fragSrc: string,
  vertSrc: string,
): WebGLProgram {
  // #version 300 es must be the very first line — prepend it before defines.
  const defineStr =
    Object.entries(defines)
      .filter(([, v]) => v !== false)
      .map(([k, v]) => `#define ${k} ${v}`)
      .join('\n') + '\n';
  const prefix = '#version 300 es\n' + defineStr;

  const vert = compileShader(gl, gl.VERTEX_SHADER, prefix + vertSrc);
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, prefix + fragSrc);

  const prog = gl.createProgram()!;
  gl.attachShader(prog, vert);
  gl.attachShader(prog, frag);
  gl.linkProgram(prog);
  gl.deleteShader(vert);
  gl.deleteShader(frag);

  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog);
    throw new Error(`Program link error:\n${log}`);
  }
  return prog;
}

export function initTexture(gl: WebGL2RenderingContext, tex: WebGLTexture): void {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

export function uploadPaletteTexture(
  gl: WebGL2RenderingContext,
  tex: WebGLTexture,
  palette: ColorList,
): void {
  if (palette.length === 0) throw new Error('Palette must contain at least one color');
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA8,
    palette.length,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    paletteToRGBA(palette),
  );
}
