import "three";
import constants from "./constants";
import ammoWorker from "./src/ammo.worker";
export const CONSTANTS = constants;
export const AmmoWorker = ammoWorker;

import { iterateGeometries } from "three-to-ammo";
const MESSAGE_TYPES = CONSTANTS.MESSAGE_TYPES;

export const WorkerHelpers = function(ammoWorker) {
  const transform = new THREE.Matrix4();
  const inverse = new THREE.Matrix4();

  const addBody = function(uuid, mesh, options = {}) {
    inverse.copy(mesh.parent.matrixWorld).invert();
    transform.multiplyMatrices(inverse, mesh.matrixWorld);
    ammoWorker.postMessage({
      type: MESSAGE_TYPES.ADD_BODY,
      uuid,
      matrix: transform.elements,
      options
    });
  };

  const removeBody = function(uuid) {
    ammoWorker.postMessage({
      type: MESSAGE_TYPES.REMOVE_BODY,
      uuid
    });
  };

  const addShapes = function(bodyUuid, shapesUuid, mesh, options = {}) {
    if (mesh) {
      inverse.copy(mesh.parent.matrix).invert();
      transform.multiplyMatrices(inverse, mesh.parent.matrix);
      const vertices = [];
      const matrices = [];
      const indexes = [];

      mesh.updateMatrixWorld(true);
      iterateGeometries(mesh, options, (vertexArray, matrix, index) => {
        vertices.push(vertexArray);
        matrices.push(matrix);
        indexes.push(index);
      });

      ammoWorker.postMessage({
        type: MESSAGE_TYPES.ADD_SHAPES,
        bodyUuid,
        shapesUuid,
        vertices,
        matrices,
        indexes,
        matrixWorld: mesh.matrixWorld.elements,
        options
      });
    } else {
      ammoWorker.postMessage({
        type: MESSAGE_TYPES.ADD_SHAPES,
        bodyUuid,
        shapesUuid,
        options
      });
    }
  };

  const removeShapes = function(bodyUuid, shapesUuid) {
    ammoWorker.postMessage({
      type: MESSAGE_TYPES.REMOVE_SHAPES,
      bodyUuid,
      shapesUuid
    });
  };

  const addConstraint = function(constraintId, bodyUuid, targetUuid, options = {}) {
    ammoWorker.postMessage({
      type: MESSAGE_TYPES.ADD_CONSTRAINT,
      constraintId,
      bodyUuid,
      targetUuid,
      options
    });
  };

  const removeConstraint = function(constraintId) {
    ammoWorker.postMessage({
      type: MESSAGE_TYPES.REMOVE_CONSTRAINT,
      constraintId
    });
  };

  const updateBody = function(uuid, options) {
    ammoWorker.postMessage({
      type: MESSAGE_TYPES.UPDATE_BODY,
      uuid,
      options
    });
  };

  const enableDebug = function(enable, debugSharedArrayBuffer) {
    ammoWorker.postMessage({
      type: MESSAGE_TYPES.ENABLE_DEBUG,
      enable,
      debugSharedArrayBuffer
    });
  };

  const resetDynamicBody = function(uuid) {
    ammoWorker.postMessage({
      type: MESSAGE_TYPES.RESET_DYNAMIC_BODY,
      uuid
    });
  };

  const activateBody = function(uuid) {
    ammoWorker.postMessage({
      type: MESSAGE_TYPES.ACTIVATE_BODY,
      uuid
    });
  };

  const applyForceToBody = function(uuid, vec) {
    ammoWorker.postMessage({
      type: MESSAGE_TYPES.APPLY_FORCE,
      uuid,
      vec
    });
  };

  const applyImpulseToBody = function(uuid, vec) {
    ammoWorker.postMessage({
      type: MESSAGE_TYPES.APPLY_IMPULSE,
      uuid,
      vec
    });
  };

  const setLinearVelocity = function(uuid, vec) {
    ammoWorker.postMessage({
      type: MESSAGE_TYPES.SET_LINEAR_VELOCITY,
      uuid,
      vec
    });
  };

  const setAngularVelocity = function(uuid, vec) {
    ammoWorker.postMessage({
      type: MESSAGE_TYPES.SET_ANGULAR_VELOCITY,
      uuid,
      vec
    });
  };

  return {
    addBody,
    updateBody,
    removeBody,
    addShapes,
    removeShapes,
    addConstraint,
    removeConstraint,
    enableDebug,
    resetDynamicBody,
    activateBody,
    applyForceToBody,
    applyImpulseToBody,
    setLinearVelocity,
    setAngularVelocity
  };
};
