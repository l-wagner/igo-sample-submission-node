export const initialFormState = {
  allContainers: [],
  allApplications: [],
  allMaterials: [],
  allPatientIdFormats: [],
  filteredApplications: [],
  filteredContainers: [],
  formIsLoading: false,
  initialFetched: false,
  filteredMaterials: [],
  picklists: {},

  allSpecies: [],
  filteredSpecies: [],

  patientIDTypeNeedsFormatting: false,
  selected: {
    application: '',
    material: '',
    serviceId: '',
    numberOfSamples: '',
    species: '',
    container: '',
    patientIdType: '',
    groupingChecked: false,
    altServiceId: false,
    isShared: false,
    sharedWith: "",
  }, 
  // selected: {
  //   application: 'MouseWholeGenome',
  //   material: 'DNA',
  //   serviceId: '898989',
  //   numberOfSamples: '10',
  //   species: 'Mouse',
  //   container: 'Plates',
  //   patientIdType: 'MSK Patients',
  //   groupingChecked: false,
  //   altServiceId: false,
  //   isShared: false,
  //   sharedWith: "",
  // },
  // selected: {
  //   application: 'AmpliSeq',
  //   material: 'DNA',
  //   serviceId: '898989',
  //   numberOfSamples: '10',
  //   species: 'Mouse',
  //   container: 'Plates',
  //   patientIdType: '',
  //   groupingChecked: false,
  //   altServiceId: false,
  // },
  // selected: {
  //   application: '',
  //   material: '',
  //   serviceId: '',
  //   numberOfSamples: '',
  //   species: '',
  //   container: '',
  //   patientIdType: '',
  //   groupingChecked: false,
  //   altServiceId: false,
  // },
}

export const initialGridState = {
  columnFeatures: [],
  columnHeaders: [],
  rows: [],
  gridError: '',
  form: [],
  gridIsLoading: false,
  isSaving: false,
  nothingToChange: false,
}


export const initialPromoteState = {
  columnHeaders: [],
  rows: [],

  initialFetched: false,
}