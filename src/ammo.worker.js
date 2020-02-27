import CONSTANTS from "../constants.js";
const MESSAGE_TYPES = CONSTANTS.MESSAGE_TYPES;
const TYPE = CONSTANTS.TYPE;
const SHAPE = CONSTANTS.SHAPE;
const CONSTRAINT = CONSTANTS.CONSTRAINT;
const BUFFER_CONFIG = CONSTANTS.BUFFER_CONFIG;
const BUFFER_STATE = CONSTANTS.BUFFER_STATE;
import * as THREE from "three";
import World from "./world";
import Body from "./body";
import Constraint from "./constraint";
import { DefaultBufferSize } from "ammo-debug-drawer";

import { createCollisionShapes } from "three-to-ammo";
import Ammo from "ammo.js/builds/ammo.wasm.js";
import AmmoWasm from "ammo.js/builds/ammo.wasm.wasm";
const AmmoModule = Ammo.bind(undefined, {
  locateFile(path) {
    if (path.endsWith(".wasm")) {
      return new URL(AmmoWasm, location.origin).href;
    }
    return path;
  }
});

const uuids = [];
const bodies = {};
const shapes = {};
const constraints = {};
const matrices = {};
const indexes = {};
const ptrToIndex = {};

const messageQueue = [];

let freeIndex = 0;
const freeIndexArray = new Int32Array(BUFFER_CONFIG.MAX_BODIES);
for (let i = 0; i < BUFFER_CONFIG.MAX_BODIES - 1; i++) {
  freeIndexArray[i] = i + 1;
}
freeIndexArray[BUFFER_CONFIG.MAX_BODIES - 1] = -1;

let world, headerIntArray, objectMatricesFloatArray, objectMatricesIntArray, lastTick, getPointer;
let usingSharedArrayBuffer = false;

function isBufferConsumed() {
  if (usingSharedArrayBuffer) {
    return headerIntArray && Atomics.load(headerIntArray, 0) !== BUFFER_STATE.READY;
  } else {
    return objectMatricesFloatArray && objectMatricesFloatArray.buffer.byteLength !== 0;
  }
}

function releaseBuffer() {
  if (usingSharedArrayBuffer) {
    Atomics.store(headerIntArray, 0, BUFFER_STATE.READY);
  } else {
    postMessage({ type: MESSAGE_TYPES.TRANSFER_DATA, objectMatricesFloatArray }, [objectMatricesFloatArray.buffer]);
  }
}

const tick = () => {
  if (isBufferConsumed()) {
    const now = performance.now();
    const dt = now - lastTick;
    world.step(dt / 1000);
    lastTick = now;

    while (messageQueue.length > 0) {
      const message = messageQueue.shift();
      switch (message.type) {
        case MESSAGE_TYPES.ADD_BODY:
          addBody(message);
          break;
        case MESSAGE_TYPES.UPDATE_BODY:
          updateBody(message);
          break;
        case MESSAGE_TYPES.REMOVE_BODY:
          removeBody(message);
          break;
        case MESSAGE_TYPES.ADD_SHAPES:
          addShapes(message);
          break;
        case MESSAGE_TYPES.ADD_CONSTRAINT:
          addConstraint(message);
          break;
        case MESSAGE_TYPES.RESET_DYNAMIC_BODY:
          resetDynamicBody(message);
          break;
        case MESSAGE_TYPES.ACTIVATE_BODY:
          activateBody(message);
      }
    }

    /** Buffer Schema
     * Every physics body has 26 * 4 bytes (64bit float/int) assigned in the buffer
     * 0-15:  Matrix4 elements (floats)
     * 16:    Linear Velocity (float)
     * 17:    Angular Velocity (float)
     * 18-25: first 8 Collisions (ints)
     */

    for (let i = 0; i < uuids.length; i++) {
      const uuid = uuids[i];
      const body = bodies[uuid];
      const index = indexes[uuid];
      const matrix = matrices[uuid];

      matrix.fromArray(objectMatricesFloatArray, index * BUFFER_CONFIG.BODY_DATA_SIZE);
      body.updateShapes();

      if (body.type === TYPE.DYNAMIC) {
        body.syncFromPhysics();
      } else {
        body.syncToPhysics(false);
      }

      objectMatricesFloatArray.set(matrix.elements, index * BUFFER_CONFIG.BODY_DATA_SIZE);

      objectMatricesFloatArray[i * BUFFER_CONFIG.BODY_DATA_SIZE + 16] = body.physicsBody.getLinearVelocity().length();
      objectMatricesFloatArray[i * BUFFER_CONFIG.BODY_DATA_SIZE + 17] = body.physicsBody.getAngularVelocity().length();

      const ptr = getPointer(body.physicsBody);
      const collisions = world.collisions.get(ptr);
      for (let j = 18; j < BUFFER_CONFIG.BODY_DATA_SIZE; j++) {
        if (!collisions || j >= collisions.length) {
          objectMatricesIntArray[index * BUFFER_CONFIG.BODY_DATA_SIZE + j] = -1;
        } else {
          const collidingPtr = collisions[j];
          if (ptrToIndex[collidingPtr]) {
            objectMatricesIntArray[index * BUFFER_CONFIG.BODY_DATA_SIZE + j] = ptrToIndex[collidingPtr];
          }
        }
      }
    }

    releaseBuffer();
  }
};
const initSharedArrayBuffer = sharedArrayBuffer => {
  /** BUFFER HEADER
   * When using SAB, the first 4 bytes (1 int) are reserved for signaling BUFFER_STATE
   * This is used to determine which thread is currently allowed to modify the SAB.
   */
  usingSharedArrayBuffer = true;
  headerIntArray = new Int32Array(sharedArrayBuffer, 0, BUFFER_CONFIG.HEADER_LENGTH);
  objectMatricesFloatArray = new Float32Array(
    sharedArrayBuffer,
    BUFFER_CONFIG.HEADER_LENGTH * 4,
    BUFFER_CONFIG.BODY_DATA_SIZE * BUFFER_CONFIG.MAX_BODIES
  );
  objectMatricesIntArray = new Int32Array(
    sharedArrayBuffer,
    BUFFER_CONFIG.HEADER_LENGTH * 4,
    BUFFER_CONFIG.BODY_DATA_SIZE * BUFFER_CONFIG.MAX_BODIES
  );
};

const initTransferrables = arrayBuffer => {
  objectMatricesFloatArray = new Float32Array(arrayBuffer);
  objectMatricesIntArray = new Int32Array(arrayBuffer);
};

function initDebug(debugSharedArrayBuffer, world) {
  const debugIndexArray = new Uint32Array(debugSharedArrayBuffer, 0, 1);
  const debugVerticesArray = new Float32Array(debugSharedArrayBuffer, 4, DefaultBufferSize);
  const debugColorsArray = new Float32Array(debugSharedArrayBuffer, 4 + DefaultBufferSize, DefaultBufferSize);
  world.getDebugDrawer(debugIndexArray, debugVerticesArray, debugColorsArray);
}

function addBody({ uuid, matrix, options }) {
  if (freeIndex !== -1) {
    const nextFreeIndex = freeIndexArray[freeIndex];
    freeIndexArray[freeIndex] = -1;

    indexes[uuid] = freeIndex;
    uuids.push(uuid);
    const transform = new THREE.Matrix4();
    transform.fromArray(matrix);
    matrices[uuid] = transform;

    objectMatricesFloatArray.set(transform.elements, freeIndex * BUFFER_CONFIG.BODY_DATA_SIZE);
    bodies[uuid] = new Body(options || {}, transform, world);
    const ptr = getPointer(bodies[uuid].physicsBody);
    ptrToIndex[ptr] = freeIndex;

    postMessage({ type: MESSAGE_TYPES.BODY_READY, uuid, index: freeIndex });
    freeIndex = nextFreeIndex;
  }
}

function updateBody({ uuid, options }) {
  if (bodies[uuid]) {
    bodies[uuid].update(options);
    bodies[uuid].physicsBody.activate(true);
  }
}

function removeBody({ uuid }) {
  delete ptrToIndex[getPointer(bodies[uuid].physicsBody)];
  bodies[uuid].destroy();
  delete bodies[uuid];
  delete matrices[uuid];
  delete shapes[uuid];
  const index = indexes[uuid];
  freeIndexArray[index] = freeIndex;
  freeIndex = index;
  delete indexes[uuid];
  uuids.splice(uuids.indexOf(uuid), 1);
}

const IDENTITY_MATRIX = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function addShapes({ bodyUuid, shapesUuid, vertices, matrices, indexes, matrixWorld, options }) {
  if (!bodies[bodyUuid]) return;

  if (!matrixWorld) {
    matrixWorld = IDENTITY_MATRIX;
  }

  const physicsShapes = createCollisionShapes(vertices, matrices, indexes, matrixWorld, options || { type: SHAPE.BOX });
  for (let i = 0; i < physicsShapes.length; i++) {
    const shape = physicsShapes[i];
    bodies[bodyUuid].addShape(shape);
  }
  shapes[shapesUuid] = physicsShapes;
}

function addConstraint({ constraintId, bodyUuid, targetUuid, options }) {
  if (bodies[bodyUuid] && bodies[targetUuid]) {
    options = options || {};
    if (!options.hasOwnProperty("type")) {
      options.type = CONSTRAINT.LOCK;
    }
    const constraint = new Constraint(options, bodies[bodyUuid], bodies[targetUuid], world);
    constraints[constraintId] = constraint;
  }
}

function resetDynamicBody({ uuid }) {
  if (bodies[uuid]) {
    const body = bodies[uuid];
    const index = indexes[uuid];
    matrices[uuid].fromArray(objectMatricesFloatArray, index * BUFFER_CONFIG.BODY_DATA_SIZE);
    body.syncToPhysics(true);
    body.physicsBody.getLinearVelocity().setValue(0, 0, 0);
    body.physicsBody.getAngularVelocity().setValue(0, 0, 0);
  }
}

function activateBody({ uuid }) {
  if (bodies[uuid]) {
    bodies[uuid].physicsBody.activate();
  }
}

onmessage = async event => {
  if (event.data.type === MESSAGE_TYPES.INIT) {
    AmmoModule().then(Ammo => {
      getPointer = Ammo.getPointer;

      if (event.data.sharedArrayBuffer) {
        initSharedArrayBuffer(event.data.sharedArrayBuffer);
      } else if (event.data.arrayBuffer) {
        initTransferrables(event.data.arrayBuffer);
      } else {
        console.error("A valid ArrayBuffer or SharedArrayBuffer is required.");
      }

      world = new World(event.data.worldConfig || {});
      lastTick = performance.now();
      self.setInterval(tick, 0);
      postMessage({ type: MESSAGE_TYPES.READY });
    });
  } else if (event.data.type === MESSAGE_TYPES.TRANSFER_DATA) {
    objectMatricesFloatArray = event.data.objectMatricesFloatArray;
    objectMatricesIntArray = new Int32Array(objectMatricesFloatArray.buffer);
  } else if (world) {
    switch (event.data.type) {
      case MESSAGE_TYPES.ADD_BODY: {
        messageQueue.push(event.data);
        break;
      }

      case MESSAGE_TYPES.UPDATE_BODY: {
        messageQueue.push(event.data);
        break;
      }

      case MESSAGE_TYPES.REMOVE_BODY: {
        const uuid = event.data.uuid;
        if (uuids.indexOf(uuid) !== -1) {
          messageQueue.push(event.data);
        }
        break;
      }

      case MESSAGE_TYPES.ADD_SHAPES: {
        const bodyUuid = event.data.bodyUuid;
        if (bodies[bodyUuid]) {
          addShapes(event.data);
        } else {
          messageQueue.push(event.data);
        }
        break;
      }

      case MESSAGE_TYPES.REMOVE_SHAPES: {
        const bodyUuid = event.data.bodyUuid;
        const shapesUuid = event.data.shapesUuid;
        if (bodies[bodyUuid] && shapes[shapesUuid]) {
          for (let i = 0; i < shapes[shapesUuid].length; i++) {
            const shape = shapes[shapesUuid][i];
            bodies[bodyUuid].removeShape(shape);
          }
        }
        break;
      }

      case MESSAGE_TYPES.ADD_CONSTRAINT: {
        const bodyUuid = event.data.bodyUuid;
        const targetUuid = event.data.targetUuid;
        if (bodies[bodyUuid] && bodies[targetUuid]) {
          addConstraint(event.data);
        } else {
          messageQueue.push(event.data);
        }
        break;
      }

      case MESSAGE_TYPES.REMOVE_CONSTRAINT: {
        const constraintId = event.data.constraintId;
        if (constraints[constraintId]) {
          constraints[constraintId].destroy();
          delete constraints[constraintId];
        }
        break;
      }

      case MESSAGE_TYPES.ENABLE_DEBUG: {
        const enable = event.data.enable;
        if (!world.debugDrawer) {
          initDebug(event.data.debugSharedArrayBuffer, world);
        }

        if (world.debugDrawer) {
          if (enable) {
            world.debugDrawer.enable();
          } else {
            world.debugDrawer.disable();
          }
        }
        break;
      }

      case MESSAGE_TYPES.RESET_DYNAMIC_BODY: {
        messageQueue.push(event.data);
        break;
      }

      case MESSAGE_TYPES.ACTIVATE_BODY: {
        messageQueue.push(event.data);
        break;
      }
    }
  } else {
    console.error("Error: World Not Initialized", event.data);
  }
};