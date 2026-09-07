import * as T from "three";
export class JetHeat {
  private target = new T.WebGLRenderTarget(1, 1, {
    depthTexture: new T.DepthTexture(1, 1),
    type: T.HalfFloatType,
    samples: 4,
  });
  private scene = new T.Scene();
  private camera = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private material = new T.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    uniforms: {
      image: { value: null },
      depth: { value: null },
      time: { value: 0 },
      power: { value: 0 },
      aspect: { value: 1 },
      a: { value: new T.Vector3() },
      b: { value: new T.Vector3() },
    },
    vertexShader:
      "varying vec2 v;void main(){v=uv;gl_Position=vec4(position.xy,0.,1.);}",
    fragmentShader: `varying vec2 v;uniform sampler2D image;uniform sampler2D depth;uniform vec3 a,b;uniform float time,power,aspect;
void main(){vec2 axis=(b.xy-a.xy)*vec2(aspect,1.);vec2 delta=(v-a.xy)*vec2(aspect,1.);float along=clamp(dot(delta,axis)/max(.00001,dot(axis,axis)),0.,1.);float distance=length(delta-axis*along);float mask=exp(-distance*distance/ (.00018+along*.00065))*sin(along*3.14159);float z=mix(a.z,b.z,along);mask*=step(z-.002,texture2D(depth,v).r);vec2 noise=vec2(sin(v.y*340.-time*10.+sin(v.x*150.+time*5.)),cos(v.x*290.+time*8.));vec2 uv=v+noise*mask*power*.0023;gl_FragColor=texture2D(image,clamp(uv,.001,.999));
#include <colorspace_fragment>
}`,
  });
  constructor() {
    this.scene.add(new T.Mesh(new T.PlaneGeometry(2, 2), this.material));
  }
  render(
    renderer: T.WebGLRenderer,
    scene: T.Scene,
    camera: T.Camera,
    model: T.Object3D,
    time: number,
    power: number,
  ) {
    if (power < 0.03) {
      renderer.render(scene, camera);
      return;
    }
    const size = renderer.getDrawingBufferSize(new T.Vector2());
    if (this.target.width !== size.x || this.target.height !== size.y)
      this.target.setSize(size.x, size.y);
    const project = (z: number) =>
      model
        .localToWorld(new T.Vector3(0, 2.88, z))
        .project(camera)
        .multiplyScalar(0.5)
        .addScalar(0.5);
    const u = this.material.uniforms;
    u.a.value.copy(project(13.8));
    u.b.value.copy(project(24));
    u.time.value = time;
    u.power.value = power;
    u.aspect.value = size.x / size.y;
    renderer.setRenderTarget(this.target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    u.image.value = this.target.texture;
    u.depth.value = this.target.depthTexture;
    renderer.render(this.scene, this.camera);
  }
}
