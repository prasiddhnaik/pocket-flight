async (page) => {
  await page.goto("about:blank");
  await page.setViewportSize({ width: 1920, height: 1200 });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1920,
    height: 1200,
    deviceScaleFactor: 2,
    mobile: false,
  });
  const version = await cdp.send("Browser.getVersion");
  let launchArguments = null;
  try {
    launchArguments = (await cdp.send("Browser.getBrowserCommandLine"))
      .arguments;
  } catch {
    /* Control results still verify pacing. */
  }
  const controls = await page.evaluate(async () => {
    async function measure(draw, duration = 3000) {
      const intervals = [];
      let previous,
        hiddenFrames = 0;
      const start = performance.now();
      await new Promise((resolve) => {
        function frame(now) {
          draw?.(now);
          if (now - start > 1000 && previous !== undefined) {
            intervals.push(now - previous);
            if (document.hidden) hiddenFrames++;
          }
          previous = now;
          if (now - start < duration + 1000) requestAnimationFrame(frame);
          else resolve();
        }
        requestAnimationFrame(frame);
      });
      const sorted = [...intervals].sort((a, b) => a - b);
      return {
        fps: (1000 * intervals.length) / intervals.reduce((a, b) => a + b, 0),
        frames: intervals.length,
        medianMs: sorted[Math.floor(sorted.length / 2)],
        p95Ms: sorted[Math.floor(sorted.length * 0.95)],
        hiddenFrames,
        intervals: intervals.slice(0, 512),
        storedIntervalLimit: 512,
      };
    }
    const blank = [];
    for (let i = 0; i < 3; i++) blank.push(await measure());
    const square = document.createElement("div");
    Object.assign(square.style, {
      width: "64px",
      height: "64px",
      background: "#197aa5",
    });
    document.body.append(square);
    const animatedDom = await measure((now) => {
      square.style.transform = `translateX(${100 + Math.sin(now * 0.003) * 90}px)`;
    });
    square.remove();
    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 720;
    document.body.append(canvas);
    const gl = canvas.getContext("webgl2", { antialias: true });
    if (!gl) throw new Error("WebGL2 unavailable");
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    const gpu = debug
      ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER);
    function shader(type, source) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(shader));
      return shader;
    }
    const vertex = shader(
      gl.VERTEX_SHADER,
      "#version 300 es\nin vec2 p;uniform float angle;void main(){float c=cos(angle),s=sin(angle);gl_Position=vec4(mat2(c,-s,s,c)*p,0.,1.);}",
    );
    const fragment = shader(
      gl.FRAGMENT_SHADER,
      "#version 300 es\nprecision mediump float;out vec4 color;void main(){color=vec4(.2,.7,.9,1.);}",
    );
    const program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-0.6, -0.6, 0.6, -0.6, 0, 0.6]),
      gl.STATIC_DRAW,
    );
    const p = gl.getAttribLocation(program, "p");
    gl.enableVertexAttribArray(p);
    gl.vertexAttribPointer(p, 2, gl.FLOAT, false, 0, 0);
    const angle = gl.getUniformLocation(program, "angle");
    const webgl = await measure((now) => {
      gl.clearColor(0.08, 0.1, 0.14, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1f(angle, now * 0.001);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    });
    const error = gl.getError();
    gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    canvas.remove();
    const median = (values) =>
      [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
    return {
      blank,
      blankMedianFps: median(blank.map((t) => t.fps)),
      animatedDom,
      webgl,
      gpu,
      webglError: error,
      hardware: !/swiftshader|llvmpipe|software/i.test(gpu),
      devicePixelRatio,
      measuredAt: new Date().toISOString(),
    };
  });
  return { ...controls, version, launchArguments };
};
