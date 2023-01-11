import { ExpoWebGLRenderingContext } from "expo-gl";

const maxParticles = 32000;

const vertexShader_particle = `
uniform vec2 u_resolution;
attribute vec4 position;
attribute vec3 colour;
varying vec3 vColor;

void main(void) {
  // 1 -> 0
  vec2 normalizedPosition = (position.xy + 0.5) / u_resolution;
  // -1 -> 1
  vec2 clipSpacePosition = (normalizedPosition * 2.0) - 1.0;
  gl_Position = vec4(clipSpacePosition * vec2(1, -1), 0, 1);
  gl_PointSize = 1.0;
  vColor = colour;
}
`;
const fragmentShader_particle = `
varying lowp vec3 vColor;

void main(void) {
   gl_FragColor = vec4(vColor.bgr, 1.0);
}
`;

const vertexShader_texture = `
attribute vec4 a_position;
attribute vec2 a_texcoord;
varying vec2 v_texcoord;

void main(void) {
  gl_Position = a_position;
  v_texcoord = a_texcoord;
 }
`;
const fragmentShader_texture = `
precision mediump float;
varying lowp vec2 v_texcoord;
uniform sampler2D u_texture;
uniform float flipper;

void main(void) {
  float tex_y = flipper > 0.5 ? 1.0-v_texcoord.y : v_texcoord.y;
  gl_FragColor = texture2D(u_texture, vec2(v_texcoord.x, tex_y));	//v_texcoord
}
`;

export const Renderer = (function () {
  let gl: ExpoWebGLRenderingContext = {} as ExpoWebGLRenderingContext;

  //shader programs
  let program: WebGLProgram | null | undefined; // particle program
  let program_texture: WebGLProgram | null | undefined;

  //data
  let dynamicPositions: Float32Array | undefined;
  let dynamicColours: Uint32Array | undefined;
  let staticPositions: Float32Array | undefined;
  let staticColours: Uint32Array | undefined;

  //pointer
  let dynamicIndex = 0;
  let staticIndex = 0;

  //buffers
  let dynamicPositionBuffer: WebGLBuffer | null = null;
  let dynamicColourBuffer: WebGLBuffer | null = null;
  let staticPositionBuffer: WebGLBuffer | null = null;
  let staticColourBuffer: WebGLBuffer | null = null;

  //quad cpu resources
  let quad_positions: Float32Array | undefined;
  let quad_texcoords: Float32Array | undefined;
  let quad_indices: Uint16Array | undefined;

  //quad gpu resources
  let quad_buffer_position: WebGLBuffer | null = null;
  let quad_buffer_texcoord: WebGLBuffer | null = null;
  let quad_buffer_indices: WebGLBuffer | null = null;

  //render to texture
  let rttFramebuffer: WebGLFramebuffer | null = null;
  let rttTexture: WebGLTexture | null = null;

  //textures
  let texture_bg: WebGLTexture | null = null;
  let texture_bg_info: WebGLTexture | null = null;

  const initialize = (_gl: ExpoWebGLRenderingContext) => {
    gl = _gl;

    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(0, 0, 0, 1);

    initCPUResources();
    initGPUResources();

    reset();
  };

  const initCPUResources = () => {
    //dynamic particle data (empty initally)
    dynamicPositions = new Float32Array(maxParticles * 2); // (2 = x, y)
    dynamicColours = new Uint32Array(maxParticles);

    staticPositions = new Float32Array(maxParticles * 2);
    staticColours = new Uint32Array(maxParticles);

    // Put a unit quad in the buffer
    quad_positions = new Float32Array([-1, 1, 1, 1, -1, -1, 1, -1]);
    quad_texcoords = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
    quad_indices = new Uint16Array([0, 1, 2, 3, 2, 1]);
  };

  const initGPUResources = () => {
    initBuffers();
    initShaders();
    initTextures();
    initTextureFramebuffer();
  };

  const initBuffers = () => {
    if (!quad_positions || !quad_texcoords || !quad_indices) {
      return;
    }

    // Create an empty buffer object to store the vertex buffer
    dynamicPositionBuffer = gl.createBuffer();
    //colours
    dynamicColourBuffer = gl.createBuffer();

    //static buffers
    staticPositionBuffer = gl.createBuffer();
    staticColourBuffer = gl.createBuffer();

    // Create a buffer for positions
    quad_buffer_position = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad_buffer_position);
    gl.bufferData(gl.ARRAY_BUFFER, quad_positions, gl.STATIC_DRAW);

    // Create a buffer for texture coords
    quad_buffer_texcoord = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad_buffer_texcoord);
    gl.bufferData(gl.ARRAY_BUFFER, quad_texcoords, gl.STATIC_DRAW);

    //create an index buffer
    quad_buffer_indices = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, quad_buffer_indices);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, quad_indices, gl.STATIC_DRAW);
  };

  const initShaders = () => {
    //create programs
    program = loadProgram(vertexShader_particle, fragmentShader_particle);

    program_texture = loadProgram(vertexShader_texture, fragmentShader_texture);
  };

  const initTextures = () => {
    //create textures
    texture_bg = gl.createTexture(); //create

    gl.bindTexture(gl.TEXTURE_2D, texture_bg);
    //params -  let's assume all images are not a power of 2
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  };

  const initTextureFramebuffer = () => {
    /*render texture*/
    rttTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, rttTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    //gl.generateMipmap(gl.TEXTURE_2D);

    const level = 0;
    const internalFormat = gl.RGBA;
    const border = 0;
    const format = gl.RGBA;
    const type = gl.UNSIGNED_BYTE;
    const data = null;

    gl.texImage2D(
      gl.TEXTURE_2D,
      level,
      internalFormat,
      gl.drawingBufferWidth,
      gl.drawingBufferHeight,
      border,
      format,
      type,
      data
    );

    /*framebuffer*/
    rttFramebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, rttFramebuffer);

    // attach the texture as the first color attachment
    const attachmentPoint = gl.COLOR_ATTACHMENT0;
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      attachmentPoint,
      gl.TEXTURE_2D,
      rttTexture,
      level
    );
  };

  const loadProgram = (
    vertexShaderSource: string,
    fragmentShaderSource: string
  ) => {
    const vertexShader = loadShader(vertexShaderSource, gl.VERTEX_SHADER);
    const fragmentShader = loadShader(fragmentShaderSource, gl.FRAGMENT_SHADER);

    const program = gl.createProgram();
    if (vertexShader && fragmentShader && program) {
      gl.attachShader(program, vertexShader);
      gl.attachShader(program, fragmentShader);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.log("Something went wrong?");
        // console.log(
        //   gl.getProgramParameter(program, gl.INFO_LOG)
        // );
      }
    }
    return program;
  };

  const loadShader = (source: string, type: GLenum) => {
    const shader = gl.createShader(type);
    if (shader) {
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        // console.log(gl.getShaderParameter(shader, gl.INFO_LOG));
        console.log("invalid shader : " + gl.getShaderInfoLog(shader));
        console.log(source);
      }
    }
    return shader;
  };

  const reset = () => {
    //reset arrays
    resetArray(dynamicPositions, 0);
    resetArray(dynamicColours, 0 | 0);
    resetArray(staticPositions, 0);
    resetArray(staticColours, 0 | 0);

    //reset pointers
    dynamicIndex = staticIndex = 0;

    //update render target, currently this will lose all data, need to re push data
    gl.bindTexture(gl.TEXTURE_2D, rttTexture);
    let level = 0;
    let internalFormat = gl.RGBA;
    let border = 0;
    let format = gl.RGBA;
    let type = gl.UNSIGNED_BYTE;
    let data = null;
    gl.texImage2D(
      gl.TEXTURE_2D,
      level,
      internalFormat,
      gl.drawingBufferWidth,
      gl.drawingBufferHeight,
      border,
      format,
      type,
      data
    );

    // Set the viewport
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
  };

  const resetArray = (
    array: Float32Array | Uint32Array | undefined,
    value: number
  ) => {
    if (array) {
      var length = array.length;
      for (let i = 0; i < length; i++) array[i] = value;
    }
  };

  const addParticle = (x: number, y: number, colour: number) => {
    if (!dynamicPositions || !dynamicColours) {
      return;
    }

    const pid = dynamicIndex * 2;
    dynamicPositions[pid] = x;
    dynamicPositions[pid + 1] = y;
    dynamicColours[dynamicIndex] = colour;
    dynamicIndex++;
  };

  const addStaticParticle = (x: number, y: number, colour: number) => {
    if (!staticPositions || !staticColours) {
      return;
    }

    const pid = staticIndex * 2;
    staticPositions[pid] = x;
    staticPositions[pid + 1] = y;
    staticColours[staticIndex] = colour;
    staticIndex++;
  };

  const clear = () => {
    gl.clear(gl.COLOR_BUFFER_BIT);
  };

  const render = () => {
    if (
      !dynamicPositions ||
      !dynamicColours ||
      !program ||
      !rttTexture
    ) {
      return;
    }

    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;

    // render to our targetTexture by binding the framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, rttFramebuffer);

    // Tell WebGL how to convert from clip space to pixels
    gl.viewport(0, 0, width, height);
    //gl.clearColor(0,0,0,0);
    //clear();

    //draw static particles
    renderStaticParticles();

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    // Tell WebGL how to convert from clip space to pixels
    gl.viewport(0, 0, width, height);

    gl.clearColor(0, 0, 0, 1);

    clear();

    //render image
    if (texture_bg_info && texture_bg) {
      renderQuad(texture_bg);
    }

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    renderQuad(rttTexture, true);
    //gl.blendFunc(gl.SRC_COLOR, gl.DST_COLOR);
    gl.blendFunc(gl.ONE, gl.ZERO);

    gl.useProgram(program);

    // Bind vertex buffer object
    gl.bindBuffer(gl.ARRAY_BUFFER, dynamicPositionBuffer);
    // Pass the vertex data to the buffer
    gl.bufferData(gl.ARRAY_BUFFER, dynamicPositions, gl.DYNAMIC_DRAW);

    const positionLocation = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(
      positionLocation, // index
      2, // number of components per element
      gl.FLOAT, // type of data
      false, // normalized
      0, // stride
      0
    ); // offset

    //colours
    gl.bindBuffer(gl.ARRAY_BUFFER, dynamicColourBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, dynamicColours, gl.DYNAMIC_DRAW);
    const colourLocation = gl.getAttribLocation(program, "colour");
    gl.enableVertexAttribArray(colourLocation);
    gl.vertexAttribPointer(
      colourLocation, // index
      4, // number of components per element
      gl.UNSIGNED_BYTE, // type of data
      true, // normalized
      0, // stride
      0
    ); // offset

    const resolutionLocation = gl.getUniformLocation(program, "u_resolution");
    gl.uniform2f(resolutionLocation, width, height);
    /*
      gl.drawElements(
        gl.LINES,           // what to draw
        3,                  // number of vertices
        gl.UNSIGNED_SHORT,  // type of indices
        0);                 // offset
    */
    //gl.drawArrays(gl.TRIANGLE_STRIP, 0, 3);

    // gl.disable(gl.BLEND);
    if (dynamicIndex > 0) {
      gl.drawArrays(gl.POINTS, 0, dynamicIndex);
    }

    //reset
    dynamicIndex = 0;
    staticIndex = 0;

    gl.flush();
    gl.endFrameEXP();
  };

  const renderQuad = (texture: WebGLTexture, flipY: boolean = false) => {
    if (!program_texture) {
      return;
    }

    gl.bindTexture(gl.TEXTURE_2D, texture);

    // Tell WebGL to use our shader program pair
    gl.useProgram(program_texture);

    //flip the y coord
    gl.uniform1f(
      gl.getUniformLocation(program_texture, "flipper"),
      flipY ? 1 : 0 // Right?
    );

    // look up where the vertex data needs to go. - TODO preprocess
    const positionLocation = gl.getAttribLocation(
      program_texture,
      "a_position"
    );
    const texcoordLocation = gl.getAttribLocation(
      program_texture,
      "a_texcoord"
    );

    // Setup the attributes to pull data from our buffers
    gl.bindBuffer(gl.ARRAY_BUFFER, quad_buffer_position);
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad_buffer_texcoord);
    gl.enableVertexAttribArray(texcoordLocation);
    gl.vertexAttribPointer(texcoordLocation, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, quad_buffer_indices);

    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    // draw the quad (2 triangles, 6 vertices)
    //gl.drawArrays(gl.TRIANGLES, 0, 6);
    //end render image
  };

  const renderStaticParticles = () => {
    if (!program || !staticPositions || !staticColours) {
      return;
    }

    gl.useProgram(program);

    // Bind vertex buffer object
    gl.bindBuffer(gl.ARRAY_BUFFER, staticPositionBuffer);
    // Pass the vertex data to the buffer
    gl.bufferData(gl.ARRAY_BUFFER, staticPositions, gl.DYNAMIC_DRAW);

    const positionLocation = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(
      positionLocation, // index
      2, // number of components per element
      gl.FLOAT, // type of data
      false, // normalized
      0, // stride
      0
    ); // offset

    //colours
    gl.bindBuffer(gl.ARRAY_BUFFER, staticColourBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, staticColours, gl.DYNAMIC_DRAW);
    const colourLocation = gl.getAttribLocation(program, "colour");
    gl.enableVertexAttribArray(colourLocation);
    gl.vertexAttribPointer(
      colourLocation, // index
      4, // number of components per element
      gl.UNSIGNED_BYTE, // type of data
      true, // normalized
      0, // stride
      0
    ); // offset

    /*
      gl.drawElements(
        gl.LINES,           // what to draw
        3,                  // number of vertices
        gl.UNSIGNED_SHORT,  // type of indices
        0);                 // offset
    */
    //gl.drawArrays(gl.TRIANGLE_STRIP, 0, 3);

    if (staticIndex > 0) {
      gl.drawArrays(gl.POINTS, 0, staticIndex);
    }
  };

  // const renderImageToStaticTexture = (can) => {
  //   if (!gl) {
  //     return;
  //   }

  //   //TODO BLIT THIS WITHOUT ANY SIZE - maybe
  //   let temp_texture = gl.createTexture(); //create

  //   gl.bindTexture(gl.TEXTURE_2D, temp_texture);
  //   gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  //   gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  //   gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); //NEAREST

  //   //gl.texImage2D(gl.TEXTURE_2D, level, internalFormat, canvas.width, canvas.height, border, format, type, canvas);
  //   gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, can);

  //   // render to our targetTexture by binding the framebuffer
  //   gl.bindFramebuffer(gl.FRAMEBUFFER, rttFramebuffer);

  //   // Tell WebGL how to convert from clip space to pixels
  //   gl.viewport(0, 0, gl.canvas.width, gl.canvas.height); //TODO derive this maybe from vars

  //   if (temp_texture) {
  //     renderQuad(temp_texture);
  //   }

  //   gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  //   // Tell WebGL how to convert from clip space to pixels
  //   gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

  //   //gl.clearColor(0,0,0,1);
  //   //this.clear();
  // };

  // const addImageBelowParticles = (image: string) => {
  //   if (image) {
  //     //load image as string
  //     if (typeof image === 'string') {
  //       let img = new Image();
  //       img.addEventListener('load', function () {
  //         if (!gl) {
  //           return;
  //         }

  //         texture_bg_info = {
  //           width: img.width,
  //           height: img.height,
  //           img: img,
  //           texture: texture_bg,
  //         };
  //         //bind and upload
  //         gl.bindTexture(gl.TEXTURE_2D, texture_bg);
  //         gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  //       });
  //       img.src = image;
  //     } else {
  //       //TODO use canvas as image source e.i:
  //       //gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  //       //TODO use Image as source
  //     }
  //   } else {
  //     texture_bg_info = null;
  //   }
  // };

  return { addParticle, addStaticParticle, clear, initialize, render };
})();
