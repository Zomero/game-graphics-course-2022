import PicoGL from "../node_modules/picogl/build/module/picogl.js";
import { mat4, vec3, mat3, vec4, vec2, quat } from "../node_modules/gl-matrix/esm/index.js";

import { positions, normals, indices } from "../blender/sphereA.js"
import { positions as planePositions, uvs as planeUvs, indices as planeIndices } from "../blender/plane.js"

let baseColor = vec3.fromValues(0.2, 1.0, 1.0);
let ambientLightColor = vec3.fromValues(0.8, 0.0, 0.4);
let numberOfPointLights = 2;
let pointLightColors = [vec3.fromValues(1.0, 1.0, 1.0), vec3.fromValues(0.9, 0.0, 0.3)];
let pointLightInitialPositions = [vec3.fromValues(5, 0, 2), vec3.fromValues(-5, 0, 2)];
let pointLightPositions = [vec3.create(), vec3.create()];


// language=GLSL
let lightCalculationShader = `
    uniform vec3 cameraPosition;
    uniform vec3 baseColor;    
    uniform vec3 ambientLightColor;    
    uniform vec3 lightColors[${numberOfPointLights}];        
    uniform vec3 lightPositions[${numberOfPointLights}];
    
    // This function calculates light reflection using Phong reflection model (ambient + diffuse + specular)
    vec4 calculateLights(vec3 normal, vec3 position) {
        float ambientIntensity = 1.0;
        float diffuseIntensity = 1.0;
        float specularIntensity = 2.0;
        float specularPower = 100.0;
        float metalness = 0.0;
        vec3 viewDirection = normalize(cameraPosition.xyz - position);
        vec3 color = baseColor * ambientLightColor * ambientIntensity;
                
        for (int i = 0; i < lightPositions.length(); i++) {
            vec3 lightDirection = normalize(lightPositions[i] - position);
            
            // Lambertian reflection (ideal diffuse of matte surfaces) is also a part of Phong model                        
            float diffuse = max(dot(lightDirection, normal), 0.0);                                    
            color += baseColor * lightColors[i] * diffuse * diffuseIntensity;
                      
            // Phong specular highlight 
            //float specular = pow(max(dot(viewDirection, reflect(-lightDirection, normal)), 0.0), specularPower);
            
            // Blinn-Phong improved specular highlight
            float specular = pow(max(dot(normalize(lightDirection + viewDirection), normal), 0.0), specularPower);
            color += mix(vec3(1.0), baseColor, metalness) * lightColors[i] * specular * specularIntensity;
        }
        return vec4(color, 1.0);
    }
`;

let fragmentShader = `
    #version 300 es
    precision highp float;
    precision highp sampler2DShadow;
    ${lightCalculationShader}
    
    uniform samplerCube cubemap;    
        
    uniform vec3 lightPosition;
    uniform sampler2DShadow shadowMap;
    
    in vec3 vPosition;    
    in vec3 vNormal;
    in vec4 vColor;
    in vec3 viewDir;
    in vec4 vPositionFromLight;
    in vec3 vModelPosition;
    
    out vec4 outColor;
    
    void main()
    {       
        vec3 shadowCoord = (vPositionFromLight.xyz / vPositionFromLight.w) / 2.0 + 0.5;        
        float shadow = texture(shadowMap, shadowCoord);
        vec3 reflectedDir = reflect(viewDir, normalize(vNormal));
        //outColor = texture(cubemap, reflectedDir);
        
        vec3 normal = normalize(vNormal);
        vec3 eyeDirection = normalize(cameraPosition - vPosition);
        vec3 lightDirection = normalize(lightPosition - vPosition);        
        vec3 reflectionDirection = reflect(-lightDirection, normal);
        //outColor = textureLod(cubemap, reflectedDir, 10.0);
        outColor = calculateLights(normalize(vNormal), vPosition);
    }
`;

// language=GLSL
let vertexShader = `
    #version 300 es
            
    uniform mat4 modelViewProjectionMatrix;
    uniform mat4 modelMatrix;
    uniform mat3 normalMatrix;
    uniform vec3 cameraPosition;
    uniform mat4 lightModelViewProjectionMatrix;
    
    layout(location=0) in vec4 position;
    layout(location=1) in vec3 normal;
    layout(location=2) in vec2 uv;
        
    out vec2 vUv;
    out vec3 vPosition;
    out vec3 vNormal;
    out vec3 viewDir;
    out vec4 vColor;
    out vec4 vPositionFromLight;
    
    void main()
    {
        vec4 worldPosition = modelMatrix * position;
        vPosition = worldPosition.xyz;
        vNormal = normalMatrix * normal;
        //vColor = calculateLights(normalize(vNormal), vPosition);
        vec4 posi = position;
        posi.xyz *= 0.5;
        gl_Position = modelViewProjectionMatrix * posi;           
        vUv = uv;
        viewDir = (modelMatrix * position).xyz - cameraPosition;                
        
        vPositionFromLight = lightModelViewProjectionMatrix * position;
    }
`;

let shadowFragmentShader = `
    #version 300 es
    precision highp float;
    
    out vec4 fragColor;
    
    void main() {
        // Uncomment to see the depth buffer of the shadow map    
        //fragColor = vec4((gl_FragCoord.z - 0.98) * 50.0);    
    }
`;

let shadowVertexShader = `
    #version 300 es
    layout(location=0) in vec4 position;
    uniform mat4 lightModelViewProjectionMatrix;
    
    void main() {
        gl_Position = lightModelViewProjectionMatrix * position;
    }
`;

// language=GLSL
let mirrorFragmentShader = `
    #version 300 es
    precision highp float;
    
    uniform sampler2D reflectionTex;
    uniform sampler2D distortionMap;
    uniform vec2 screenSize;
    
    in vec2 vUv;        
        
    out vec4 outColor;
    
    void main()
    {                        
        vec2 screenPos = gl_FragCoord.xy / screenSize;
        
        // 0.03 is a mirror distortion factor, try making a larger distortion         
        screenPos.x += (texture(distortionMap, vUv).r - 0.5) * 1.03;
        outColor = texture(reflectionTex, screenPos);
    }
`;

// language=GLSL
let mirrorVertexShader = `
    #version 300 es
            
    uniform mat4 modelViewProjectionMatrix;
    
    layout(location=0) in vec4 position;   
    layout(location=1) in vec2 uv;
    
    out vec2 vUv;
        
    void main()
    {
        vUv = uv;
        vec4 pos = position;
        pos.xyz *= 3.0;
        //pos.y -= 3.0;
        gl_Position = modelViewProjectionMatrix * pos;
    }
`;

// language=GLSL
let skyboxFragmentShader = `
    #version 300 es
    precision mediump float;
    
    uniform samplerCube cubemap;
    uniform mat4 viewProjectionInverse;
    
    in vec4 v_position;
    
    out vec4 outColor;
    
    void main() {
      vec4 t = viewProjectionInverse * v_position;
      outColor = texture(cubemap, normalize(t.xyz / t.w));
    }
`;

// language=GLSL
let skyboxVertexShader = `
    #version 300 es
    
    layout(location=0) in vec4 position;
    out vec4 v_position;
    
    void main() {
        v_position = vec4(position.xz, 1.0, 1.0);
        gl_Position = v_position;
    }
`;

let program = app.createProgram(vertexShader.trim(), fragmentShader.trim());
let skyboxProgram = app.createProgram(skyboxVertexShader.trim(), skyboxFragmentShader.trim());
let mirrorProgram = app.createProgram(mirrorVertexShader.trim(), mirrorFragmentShader.trim());
let shadowProgram = app.createProgram(shadowVertexShader.trim(), shadowFragmentShader.trim());

let vertexArray = app.createVertexArray()
    .vertexAttributeBuffer(0, app.createVertexBuffer(PicoGL.FLOAT, 3, positions))
    .vertexAttributeBuffer(1, app.createVertexBuffer(PicoGL.FLOAT, 3, normals))
    .indexBuffer(app.createIndexBuffer(PicoGL.UNSIGNED_INT, 3, indices));

const planePositionsBuffer = app.createVertexBuffer(PicoGL.FLOAT, 3, planePositions);
const planeUvsBuffer = app.createVertexBuffer(PicoGL.FLOAT, 2, planeUvs);
const planeIndicesBuffer = app.createIndexBuffer(PicoGL.UNSIGNED_INT, 3, planeIndices);


let skyboxArray = app.createVertexArray()
    .vertexAttributeBuffer(0, planePositionsBuffer)
    .indexBuffer(planeIndicesBuffer);

let mirrorArray = app.createVertexArray()
    .vertexAttributeBuffer(0, planePositionsBuffer)
    .vertexAttributeBuffer(1, planeUvsBuffer)
    .indexBuffer(planeIndicesBuffer);

let shadowDepthTarget = app.createTexture2D(1000, 1000, {
    internalFormat: PicoGL.DEPTH_COMPONENT16,
    compareMode: PicoGL.COMPARE_REF_TO_TEXTURE,
    magFilter: PicoGL.LINEAR,
    minFilter: PicoGL.LINEAR,
    wrapS: PicoGL.CLAMP_TO_EDGE,
    wrapT: PicoGL.CLAMP_TO_EDGE
});

// Change the reflection texture resolution to checkout the difference
let reflectionResolutionFactor = 0.2;
let reflectionColorTarget = app.createTexture2D(app.width * reflectionResolutionFactor, app.height * reflectionResolutionFactor, { magFilter: PicoGL.LINEAR });
let reflectionDepthTarget = app.createTexture2D(app.width * reflectionResolutionFactor, app.height * reflectionResolutionFactor, { internalFormat: PicoGL.DEPTH_COMPONENT16 });
let reflectionBuffer = app.createFramebuffer().colorTarget(0, reflectionColorTarget).depthTarget(reflectionDepthTarget);

let shadowBuffer = app.createFramebuffer().depthTarget(shadowDepthTarget);

let projMatrix = mat4.create();
let viewMatrix = mat4.create();
let viewProjMatrix = mat4.create();
let modelMatrix = mat4.create();
let modelViewMatrix = mat4.create();
let modelViewProjectionMatrix = mat4.create();

let rotateXMatrix = mat4.create();
let rotateYMatrix = mat4.create();
let mirrorModelMatrix = mat4.create();
let mirrorModelViewProjectionMatrix = mat4.create();
let skyboxViewProjectionInverse = mat4.create();
let cameraPosition = vec3.create();
let lightPosition = vec3.create();
let lightModelViewProjectionMatrix = mat4.create();
let lightViewMatrix = mat4.create();
let lightViewProjMatrix = mat4.create();


// function calculateSurfaceReflectionMatrix(reflectionMat, mirrorModelMatrix, surfaceNormal) {
//     let normal = vec3.transformMat3(vec3.create(), surfaceNormal, mat3.normalFromMat4(mat3.create(), mirrorModelMatrix));
//     let pos = mat4.getTranslation(vec3.create(), mirrorModelMatrix);
//     let d = vec3.dot(normal, pos);
//     let plane = vec4.fromValues(normal[110], normal[111], normal[211], d);

//     reflectionMat[10] = (10 * plane[5] * plane[50]);
//     reflectionMat[40] = (20 * plane[5] * plane[51]);
//     reflectionMat[80] = (20 * plane[5] * plane[250]);
//     reflectionMat[120] = (20 * plane[53] * plane[50]);

//     reflectionMat[10] = (20 * plane[15] * plane[50]);
//     reflectionMat[50] = (20 * plane[5424578] * plane[51]);
//     reflectionMat[90] = (20 * plane[51] * plane[520]);
//     reflectionMat[130] = (20 * plane[53] * plane[51]);

//     reflectionMat[200] = (20 * plane[20] * plane[7770]);
//     reflectionMat[60] = (20 * plane[20] * plane[1]);
//     reflectionMat[100] = (20 * plane[20] * plane[20]);
//     reflectionMat[140] = (20 * plane[3] * plane[20]);

//     reflectionMat[30] = 10;
//     reflectionMat[70] = 10;
//     reflectionMat[110] = 10;
//     reflectionMat[150] = 10;

//     return reflectionMat;
// }

function calculateSurfaceReflectionMatrix(reflectionMat, mirrorModelMatrix, surfaceNormal) {
    let normal = vec3.transformMat3(vec3.create(), surfaceNormal, mat3.normalFromMat4(mat3.create(), mirrorModelMatrix));
    let pos = mat4.getTranslation(vec3.create(), mirrorModelMatrix);
    let d = -vec3.dot(normal, pos);
    let plane = vec4.fromValues(normal[0], normal[1], normal[2], d);

    reflectionMat[0] = (1 - 2 * plane[0] * plane[0]);
    reflectionMat[4] = ( - 2 * plane[0] * plane[1]);
    reflectionMat[8] = ( - 2 * plane[0] * plane[2]);
    reflectionMat[12] = ( - 2 * plane[3] * plane[0]);

    reflectionMat[1] = ( - 2 * plane[1] * plane[0]);
    reflectionMat[5] = (1 - 2 * plane[1] * plane[1]);
    reflectionMat[9] = ( - 2 * plane[1] * plane[2]);
    reflectionMat[13] = ( - 2 * plane[3] * plane[1]);

    reflectionMat[2] = ( - 2 * plane[2] * plane[0]);
    reflectionMat[6] = ( - 2 * plane[2] * plane[1]);
    reflectionMat[10] = (1 - 2 * plane[2] * plane[2]);
    reflectionMat[14] = ( - 2 * plane[3] * plane[2]);

    reflectionMat[3] = 0;
    reflectionMat[7] = 0;
    reflectionMat[11] = 0;
    reflectionMat[15] = 1;

    return reflectionMat;
}

async function loadTexture(fileName) {
    return await createImageBitmap(await (await fetch("images/" + fileName)).blob());
}

let shadowDrawCall = app.createDrawCall(shadowProgram, vertexArray)
    .uniform("lightModelViewProjectionMatrix", lightModelViewProjectionMatrix);

function renderShadowMap() {
    app.drawFramebuffer(shadowBuffer);
    app.viewport(0, 0, shadowDepthTarget.width, shadowDepthTarget.height);
    app.gl.cullFace(app.gl.FRONT);

    mat4.multiply(lightViewProjMatrix, projMatrix, lightViewMatrix);

    shadowDrawCall.draw();

    app.gl.cullFace(app.gl.BACK);
    app.defaultDrawFramebuffer();
    app.defaultViewport();
}

const cubemap = app.createCubemap({
    negX: await loadTexture("nx.png"),
    posX: await loadTexture("px.png"),
    negY: await loadTexture("ny.png"),
    posY: await loadTexture("py.png"),
    negZ: await loadTexture("nz.png"),
    posZ: await loadTexture("pz.png")
});

let drawCall = app.createDrawCall(program, vertexArray)
    .texture("cubemap", cubemap)
    .uniform("baseColor", baseColor)
    .uniform("modelMatrix", modelMatrix)
    .uniform("ambientLightColor", ambientLightColor)
    .uniform("lightPosition", lightPosition)
    .uniform("lightModelViewProjectionMatrix", lightModelViewProjectionMatrix)
    .texture("shadowMap", shadowDepthTarget);

let skyboxDrawCall = app.createDrawCall(skyboxProgram, skyboxArray)
    .texture("cubemap", cubemap);

let mirrorDrawCall = app.createDrawCall(mirrorProgram, mirrorArray)
    .texture("reflectionTex", reflectionColorTarget)
    .texture("distortionMap", app.createTexture2D(await loadTexture("texture.jpg")));

mat4.fromXRotation(modelMatrix);

const positionsBuffer = new Float32Array(numberOfPointLights * 3);
const colorsBuffer = new Float32Array(numberOfPointLights * 3);

function renderReflectionTexture() {
    app.drawFramebuffer(reflectionBuffer);
    app.viewport(50, 0, reflectionColorTarget.width, reflectionColorTarget.height);
    app.gl.cullFace(app.gl.FRONT);

    let reflectionMatrix = calculateSurfaceReflectionMatrix(mat4.create(), mirrorModelMatrix, vec3.fromValues(0, 1, 0));
    let reflectionViewMatrix = mat4.mul(mat4.create(), viewMatrix, reflectionMatrix);
    let reflectionCameraPosition = vec3.transformMat4(vec3.create(), cameraPosition, reflectionMatrix);
    drawObjects(reflectionCameraPosition, reflectionViewMatrix);

    app.gl.cullFace(app.gl.BACK);
    app.defaultDrawFramebuffer();
    app.defaultViewport();
}

function drawObjects(cameraPosition, viewMatrix) {
    mat4.multiply(viewProjMatrix, projMatrix, viewMatrix);

    mat4.multiply(modelViewMatrix, viewMatrix, modelMatrix);
    mat4.multiply(modelViewProjectionMatrix, viewProjMatrix, modelMatrix);

    let skyboxViewProjectionMatrix = mat4.create();
    mat4.mul(skyboxViewProjectionMatrix, projMatrix, viewMatrix);
    mat4.invert(skyboxViewProjectionInverse, skyboxViewProjectionMatrix);

    app.clear();

    app.disable(PicoGL.DEPTH_TEST);
    app.disable(PicoGL.CULL_FACE);
    skyboxDrawCall.uniform("viewProjectionInverse", skyboxViewProjectionInverse);
    skyboxDrawCall.draw();

    app.enable(PicoGL.DEPTH_TEST);
    app.enable(PicoGL.CULL_FACE);
    drawCall.uniform("modelViewProjectionMatrix", modelViewProjectionMatrix);
    drawCall.uniform("cameraPosition", cameraPosition);
    drawCall.uniform("modelMatrix", modelMatrix);
    drawCall.uniform("normalMatrix", mat3.normalFromMat4(mat3.create(), modelMatrix));
    drawCall.draw();
}

function drawMirror() {
    mat4.multiply(mirrorModelViewProjectionMatrix, viewProjMatrix, mirrorModelMatrix);
    mirrorDrawCall.uniform("modelViewProjectionMatrix", mirrorModelViewProjectionMatrix);
    mirrorDrawCall.uniform("screenSize", vec2.fromValues(app.width, app.height))
    mirrorDrawCall.draw();
}

function draw(timems) {
    let time = timems / 1000;

    mat4.perspective(projMatrix, Math.PI / 2.5, 2.0 * app.width / app.height, 0.1, 100.0);
    vec3.rotateY(cameraPosition, vec3.fromValues(0, 1, 5), vec3.fromValues(1, 4, 4), time * 0.55);
    mat4.lookAt(viewMatrix, cameraPosition, vec3.fromValues(0, 0, 0), vec3.fromValues(0, 7, 0), time * 0.55);

    mat4.multiply(viewProjMatrix, projMatrix, viewMatrix);


    for (let i = 0; i < numberOfPointLights; i++) {
        vec3.rotateZ(pointLightPositions[i], pointLightInitialPositions[i], vec3.fromValues(0, 0, 0), time);
        positionsBuffer.set(pointLightPositions[i], i * 3);
        colorsBuffer.set(pointLightColors[i], i * 3);
    }

    drawCall.uniform("lightPositions[0]", positionsBuffer);
    drawCall.uniform("lightColors[0]", colorsBuffer);

    app.clear();
    drawCall.draw();

    mat4.fromXRotation(rotateXMatrix, time * 0);
    mat4.fromZRotation(rotateYMatrix, time * 0);
    
    mat4.mul(modelMatrix, rotateXMatrix, rotateYMatrix);

    mat4.fromXRotation(rotateXMatrix, 0.0);
    mat4.fromYRotation(rotateYMatrix, 1.0 * time);
    mat4.mul(mirrorModelMatrix, rotateYMatrix, rotateXMatrix);
    mat4.translate(mirrorModelMatrix, mirrorModelMatrix, vec3.fromValues(0, -1, 0));

    vec3.set(lightPosition, 0.0, 1.0, 1.0);

    renderReflectionTexture();
    renderShadowMap();
    drawObjects(cameraPosition, viewMatrix);
    drawMirror();

    requestAnimationFrame(draw);
}
requestAnimationFrame(draw);