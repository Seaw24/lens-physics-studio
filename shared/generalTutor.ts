import type { TutorReply } from "./physics";
export function generalPhysicsReply(text: string): TutorReply {
  const q = text.toLowerCase();
  let reply: string;
  if (/torque|rotation|rotat|hinge/.test(q))
    reply =
      "Force describes a push or pull. Torque describes its turning effect about a chosen axis: τ = rF sin θ. The same force produces more torque when applied farther from the pivot, provided the angle stays the same. Think of opening a door near the hinge versus at the handle.";
  else if (/energy|kinetic|potential|conserv/.test(q))
    reply =
      "Energy helps us keep track of change. In ideal projectile motion, kinetic energy (½mv²) and gravitational potential energy (mgh) trade places while their sum stays constant. As the ball rises, its vertical kinetic energy decreases and potential energy increases. Horizontal motion continues. Real air resistance and impact transfer some mechanical energy into heat, sound, and deformation.";
  else if (/momentum|impulse|collision/.test(q))
    reply =
      "Momentum is mass times velocity: p = mv. A net force acting for a time changes momentum; that change is impulse. Total momentum is conserved for a system with no net external impulse. During a catch, increasing the stopping time reduces the average force for the same momentum change.";
  else if (/mass|weight|heavier/.test(q))
    reply =
      "Mass measures inertia: how strongly an object resists acceleration. Weight is the gravitational force on that mass: W = mg. A heavier ball has more gravitational force and proportionally more inertia, so ideal free-fall acceleration is the same. Air resistance can change how real objects fall.";
  else if (/circuit|electric|voltage|current|resistan/.test(q))
    reply =
      "Voltage is energy transferred per unit charge. Current is the flow rate of charge. For an ohmic resistor at constant temperature, V = IR. Series components carry the same current; parallel branches share the same voltage. This demo covers the basic relationship. Connect Bedrock for a conversation about a particular circuit.";
  else if (/wave|frequency|sound/.test(q))
    reply =
      "A wave carries a disturbance through space. Frequency counts cycles per second; wavelength is the distance between corresponding points on consecutive cycles. For a wave travelling at speed v, v = fλ. Sound in air is a longitudinal wave: pressure variations move through the air.";
  else if (/gravity|gravit|apex|highest|top/.test(q))
    reply =
      "Near Earth’s surface, the ideal gravitational acceleration is about 9.81 m/s² downward. It does not switch off at the highest point of a throw. Vertical velocity is zero there for an instant; acceleration remains downward. Velocity describes the current motion, while acceleration describes its rate of change.";
  else if (/force|motion|velocity|accelerat|newton|inertia/.test(q))
    reply =
      "Motion describes how position changes. Velocity gives the rate and direction of that change; acceleration tells you how velocity changes. Net force causes acceleration: ΣF = ma. An object can move with zero net force if its velocity is constant. A force opposite the motion can slow it down.";
  else if (/unit|dimension/.test(q))
    reply =
      "Units tell you what a quantity means. Position uses metres, velocity metres per second, and acceleration metres per second squared. Force uses newtons: 1 N = 1 kg·m/s². Checking that both sides of an equation have matching units is a useful way to catch mistakes.";
  else
    reply =
      "This demo lounge has prepared explanations for forces and motion, energy, gravity, momentum, torque, waves, and basic circuits. Try a question about one of those topics. Connect Amazon Bedrock in Studio settings for open-ended physics discussion.";
  return { reply, mode: "rehearsal" };
}
