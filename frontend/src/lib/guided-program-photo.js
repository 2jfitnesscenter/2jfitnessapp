const COMMONS = 'https://commons.wikimedia.org/wiki/File:'
const CC_BY_2 = 'https://creativecommons.org/licenses/by/2.0/'

const photos = {
  strengthWoman: {
    src: '/images/guided-programs/strength-woman.jpg',
    title: 'Strong woman lifting weights in a gym focused on fitness and strength training',
    author: 'Nenad Stojković',
    source: `${COMMONS}Strong_woman_lifting_weights_in_a_gym_focused_on_fitness_and_strength_training.jpg`,
    license: CC_BY_2,
  },
  strengthMan: {
    src: '/images/guided-programs/strength-man.jpg',
    title: 'Young athlete training with a barbell in a gym',
    author: 'Nenad Stojković',
    source: `${COMMONS}Young_attractive_man_athlete_doing_exercise_with_the_barbell_in_the_gym.jpg`,
    license: CC_BY_2,
  },
  treadmill: {
    src: '/images/guided-programs/cardio-treadmill.jpg',
    title: 'Cardio training on a treadmill in a gym',
    author: 'Nenad Stojković',
    source: `${COMMONS}Fit_woman_wearing_sportswear_doing_cardio_in_gym_on_a_treadmill.jpg`,
    license: CC_BY_2,
  },
  stretch: {
    src: '/images/guided-programs/mobility-stretch.jpg',
    title: 'Stretching before or after training in a gym',
    author: 'Nenad Stojković',
    source: `${COMMONS}Fit_woman_stretching_her_leg_in_gym.jpg`,
    license: CC_BY_2,
  },
  home: {
    src: '/images/guided-programs/home-dumbbell.jpg',
    title: 'Dumbbell training at home',
    author: 'Nenad Stojković',
    source: `${COMMONS}Fitness_enthusiast_lifts_vibrant_dumbbell_during_home_workout.jpg`,
    license: CC_BY_2,
  },
  core: {
    src: '/images/guided-programs/core-leg-raise.jpg',
    title: 'Core exercise with a stability ball',
    author: 'Tyler Read',
    source: `${COMMONS}Abdominal_exercise_leg_raise.jpg`,
    license: CC_BY_2,
  },
  bodyweight: {
    src: '/images/guided-programs/bodyweight-row.jpg',
    title: 'Bodyweight row training in a gym',
    author: 'Nenad Stojković',
    source: `${COMMONS}Woman_in_a_gym_doing_bodyweight_rows.jpg`,
    license: CC_BY_2,
  },
  bike: {
    src: '/images/guided-programs/cardio-bike.jpg',
    title: 'Indoor cycling as part of cross training',
    author: 'Nenad Stojković',
    source: `${COMMONS}Young_attractive_man_practicing_on_exercise_bike_during_cross_training_in_a_gym.jpg`,
    license: CC_BY_2,
  },
}

const programPhotoKey = {
  'g2j-beginner-4w': 'bodyweight',
  'g2j-mobility-21d': 'stretch',
  'g2j-hiit-mix-4w': 'treadmill',
  'g2j-cardio-base-6w': 'treadmill',
  'g2j-return-3w': 'stretch',
  'g2j-fullbody-hypertrophy-4w': 'strengthWoman',
  'g2j-upper-lower-4w': 'strengthMan',
  'g2j-ppl-4w': 'strengthMan',
  'g2j-glutes-4w': 'strengthWoman',
  'g2j-strength-base-4w': 'strengthMan',
  'g2j-home-3w': 'home',
  'g2j-core-3w': 'core',
  'g2j-hotel-3w': 'bodyweight',
  'g2j-flexibility-4w': 'stretch',
  'g2j-recovery-2w': 'stretch',
  'g2j-machine-hiit-4w': 'treadmill',
  'g2j-lowimpact-cardio-4w': 'bike',
  'g2j-tabata-4w': 'treadmill',
  'g2j-strength-cardio-3w': 'strengthWoman',
  'g2j-bodyweight-hiit-3w': 'bodyweight',
  'g2j-split-hypertrophy-4w': 'strengthMan',
  'g2j-beginner-split-4w': 'strengthWoman',
}

export function photoForGuidedProgram(program) {
  const mapped = photos[programPhotoKey[program?.id]]
  if (mapped) return mapped
  return photos[program?.cover === 'mobility' ? 'stretch' : program?.cover === 'core' ? 'core' : program?.cover === 'strength' ? 'strengthWoman' : program?.cover === 'interval' || program?.cover === 'hiit' || program?.cover === 'tabata' ? 'treadmill' : 'bodyweight']
}

export const GUIDED_PROGRAM_PHOTO_IDS = Object.freeze(Object.keys(programPhotoKey))
