const services = require('../services/services');
const { logger } = require('../util/winston');
const { constants } = require('./constants');
const allColumns = require('./columns');
import CacheService from './cache';
const ttl = 60 * 60 * 1; // cache for 1 Hour
const cache = new CacheService(ttl); // Create a new cache service instance

exports.determineRole = (groups) => {
  if (groups.includes(process.env.LAB_GROUP)) return 'lab_member';
  if (groups.includes(process.env.PM_GROUP)) return 'project_manager';
  else return 'user';
};

exports.createSharedString = (shared, username) => {
  let sharedSet = new Set();
  let sharedArray = shared.split(',');

  sharedSet.add(...sharedArray);
  sharedSet.add(`${username}@mskcc.org`);

  return Array.from(sharedSet).join(',');
};

exports.getContainers = (material) => {
  if (material in constants.containersByMaterial) {
    return constants.containersByMaterial[material];
  } else return [];
};

exports.getSpecies = (recipe) => {
  if (constants.humanApplications.includes(recipe.toLowerCase()))
    return ['Human'];
  if (constants.mouseApplications.includes(recipe.toLowerCase()))
    return ['Mouse'];
  if (constants.humanOrMouseApplications.includes(recipe.toLowerCase()))
    return ['Human', 'Mouse'];
  else {
    return [];
  }
};

function cacheAllPicklists(limsColumns) {
  return new Promise((resolve, reject) => {
    let picklistPromises = [];
    let picklists = {};

    limsColumns.map((columnName) => {
      if (!allColumns.gridColumns[columnName]) {
        reject(`Column '${columnName}' not found.`);
      }
      let picklist = allColumns.gridColumns[columnName].picklistName;

      if (picklist !== undefined) {
        picklists[picklist] = [];
        if (picklist === 'barcodes') {
          picklistPromises.push(
            cache.get(picklist + '-Picklist', () => services.getBarcodes())
          );
        } else if (picklist === 'tumorType') {
          picklistPromises.push(
            cache.get(picklist + '-Picklist', () => services.getOnco())
          );
        } else {
          picklistPromises.push(
            cache.get(picklist + '-Picklist', () =>
              services.getPicklist(picklist)
            )
          );
        }
      }
    });
    Promise.all(picklistPromises).then((results) => {
      if (results.some((x) => x.length === 0)) {
        reject('Could not cache picklists.');
      }
      Object.keys(picklists).map((element, index) => {
        picklists[element] = results[index];
      });
      resolve(picklists);
    });
  });
}

export function generateGrid(limsColumnList, userRole, formValues) {
  return new Promise((resolve, reject) => {
    let columns = {
      columnFeatures: [],
      rowData: [],
      columnHeaders: [],
      hiddenColumns: [],
    };

    if (!limsColumnList) {
      PromiseRejectionEvent('Invalid Combination.');
    }
    // combinations with no optional columns return an empty element we need to filter out
    limsColumnList = limsColumnList.filter((element) => element[0] !== '');
    let columnNamesOnly = limsColumnList.map((element) => {
      return element[0];
    });

    cacheAllPicklists(columnNamesOnly)
      .then((picklists) =>
        fillColumns(columns, limsColumnList, userRole, formValues, picklists)
      )
      .then((columns) => fillData(columns, formValues))
      .catch((reasons) => reject(reasons))
      .then((columns) => {
        if (columns.columnFeatures.some((x) => x.data === 'wellPosition')) {
          setWellPos(columns).then(resolve(columns));
        } else {
          resolve(columns);
        }
      })
      .catch((reasons) => reject(reasons));
  });
}

function fillColumns(
  columns,
  limsColumnList,
  userRole,
  formValues = {},
  picklists
) {
  return new Promise((resolve, reject) => {
    let requiredColumns = [];
    limsColumnList.map((item) => {
      if (item.includes('Required')) {
        requiredColumns.push(item[0]);
      }
    });
    limsColumnList.forEach((element, index) => {
      let columnName = element[0];
      let colDef = allColumns.gridColumns[columnName];
      if (!colDef) {
        reject(`Column '${columnName}' not found.`);
      }
      if (
        colDef.container &&
        colDef.container !== formValues.container &&
        formValues.application !== 'Expanded_Genomics'
      ) {
        colDef = overwriteContainer(formValues.container);
      }

      if (colDef.data === 'patientId') {
        let formattingAdjustments = choosePatientIdValidator(
          formValues.patientIdType,
          formValues.species,
          formValues.groupingChecked
        );
        colDef = { ...colDef, ...formattingAdjustments };
      }
      if (colDef.picklistName && !colDef.source) {
        if (colDef.data === 'index') {
          colDef.barcodeHash = picklists[colDef.picklistName];
        } else {
          colDef.source = picklists[colDef.picklistName];
        }
      }

      colDef.error = colDef.error ? colDef.error : 'Invalid format.';
      columns.columnFeatures.push(colDef);
      if (colDef.hiddenFrom && colDef.hiddenFrom === userRole) {
        columns.hiddenColumns.push(columns.columnFeatures.length);
      }
      colDef.optional = requiredColumns.includes(columnName) ? false : true;
      colDef.allowEmpty = colDef.optional;
      colDef.className = colDef.optional ? 'optional' : 'required';

      if (index === limsColumnList.length - 1) {
        // if plate column present but not WellPos, add WellPos
        if (
          columns.columnFeatures[0].data === 'plateId' &&
          columns.columnFeatures[1].data !== 'wellPosition'
        ) {
          columns.columnFeatures.unshift(
            allColumns.gridColumns['Well Position']
          );
        }
        // if plate column not present but WellPos is, remove WellPos
        if (
          formValues.container !== 'Plates' &&
          columns.columnFeatures[1].data === 'wellPosition'
        ) {
          columns.columnFeatures[1] = columns.columnFeatures[0];
          columns.columnFeatures.shift();
        }
        columns.columnHeaders = columns.columnFeatures.map(
          (a) =>
            '<span class="' +
            a.className +
            '" title="' +
            a.tooltip +
            '">' +
            a.columnHeader +
            '</span>'
        );
        resolve(columns);
      }
    });
  });
}

// if lims returned a container type is different from the container the user indicated, chose the user one
const overwriteContainer = (userContainer) => {
  let newContainer;
  switch (userContainer) {
  case 'Plates':
    newContainer = allColumns.gridColumns['Plate ID'];
    break;
  case 'Micronic Barcoded Tubes':
    newContainer = allColumns.gridColumns['Micronic Tube Barcode'];
    break;
  case 'Blocks/Slides/Tubes':
    newContainer = allColumns.gridColumns['Block/Slide/TubeID'];
    break;
  default:
    return `Container '${userContainer}' not found.`;
  }
  return newContainer;
};

// generate rows with same autofilled and consecutive wellPos values, only return the additional rows
export const generateAdditionalRows = (
  columnFeatures,
  formValues,
  prevRowNumber,
  newRowNumber
) => {
  return new Promise((resolve) => {
    // making sure the formValue sample number is the most recent one
    //  important for changing the row number on paste rather than through form select
    formValues.numberOfSamples = newRowNumber;
    let columns = { columnFeatures: columnFeatures, formValues: formValues };
    fillAdditionalRows(columns, formValues).then((columns) => {
      //delete all old rows
      for (let i = 0; i < prevRowNumber; i++) {
        columns.rowData.shift();
        if (i + 1 === prevRowNumber) {
          resolve(columns.rowData);
        }
      }
    });
  });
};

const fillAdditionalRows = (columns, formValues) => {
  return new Promise((resolve) => {
    fillData(columns, formValues).then((columns) => {
      if (columns.columnFeatures.some((x) => x.data === 'wellPosition')) {
        columns = setWellPos(columns).then((columns) => {
          resolve(columns);
        });
      } else resolve(columns);
    });
  });
};

// Lots of autofilling happening here
const fillData = (columns, formValues) => {
  return new Promise((resolve) => {
    let rowData = [];
    let numberOfRows = formValues.numberOfSamples;
    for (var i = 0; i < numberOfRows; i++) {
      columns.columnFeatures.map((entry) => {
        rowData[i] = { ...rowData[i], [entry.data]: '' };
        if (entry.data === 'species' || entry.data === 'organism') {
          rowData[i] = {
            ...rowData[i],
            organism: formValues.species,
          };
        }
        if (entry.data === 'preservation') {
          if (formValues.material === 'Blood') {
            rowData[i] = {
              ...rowData[i],
              preservation: 'EDTA-Streck',
            };
          } else if (formValues.material === 'Buffy Coat') {
            rowData[i] = {
              ...rowData[i],
              preservation: 'Frozen',
            };
          }
        }
        if (entry.data === 'sampleOrigin') {
          if (formValues.material === 'Blood') {
            rowData[i] = {
              ...rowData[i],
              sampleOrigin: 'Whole Blood',
            };
          } else if (formValues.material === 'Buffy Coat') {
            rowData[i] = {
              ...rowData[i],
              sampleOrigin: 'Buffy Coat',
            };
          }
        }
        if (entry.data === 'specimenType') {
          if (
            formValues.material === 'Blood' ||
            formValues.material === 'Buffy Coat'
          ) {
            rowData[i] = {
              ...rowData[i],
              specimenType: 'Blood',
            };
          }
        }
        if (
          entry.data === 'patientId' &&
          entry.columnHeader === 'Cell Line Name'
        ) {
          rowData[i] = { ...rowData[i], specimenType: 'CellLine' };
        }
      });
      if (rowData.length === numberOfRows) {
        columns.rowData = rowData;
        resolve(columns);
      }
    }
  });
};

// pre-filling WellPosition for a plate of 96 wells
// times = how many times bigger is the #samples than the plate rows (8 A-H) -
// how many columns will have to be filled, used as end condition
// i = counter indicating how often I stepped through A-H
// plateColIndex = plate column
const setWellPos = (columns) => {
  return new Promise((resolve) => {
    let rows = columns.rowData;
    let plateRows = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    let numPlates = Math.ceil(rows.length / plateRows.length);
    let i = 0;

    // multiply available plateRows by how many plates will be filled in this submission
    for (let k = 0; k < numPlates; k++) {
      plateRows = plateRows.concat(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
    }
    let plateColIndex = 1;
    let rowCounter = 0;
    //  step through as many plates as you have to
    while (i < numPlates) {
      // fill rows first
      for (let j = 0; j < plateRows.length; j++) {
        // if rows A-H have been filled, flip colIndex
        if (rowCounter === 8) {
          rowCounter = 0;
          plateColIndex += 1;
        }
        // if colIndes reaches 13, all wells have been filled, colIndex flips back to 1 and a new plate is filled
        if (plateColIndex === 13) {
          plateColIndex = 1;
        }
        if (rows[j + plateRows.length * i]) {
          // fill row at position plateRows * number of plates you did this with already
          rows[j + plateRows.length * i].wellPosition =
            plateRows[j] + plateColIndex;
        } else {
          break;
        }
        rowCounter++;
      }
      plateColIndex++;
      i++;
    }
    columns.rows = rows;
    resolve(columns);
  });
};

// patient id validation depends on user selected id type
function choosePatientIdValidator(patientIDType, species, groupingChecked) {
  if (species === 'Mouse' || species === 'Mouse_GeneticallyModified') {
    if (groupingChecked) {
      return {
        pattern: '[A-Za-z0-9\\,_-]{4,}',
        columnHeader: 'Grouping ID',
        error:
          'Invalid format. Please use at least four alpha-numeric characters. Every 8 digit ID is considered a MRN.',
      };
    } else {
      return {
        pattern: '[0-9a-zA-Z]{4,}',
        columnHeader: 'Strain or Line Name',
        error:
          'Invalid format. Please use at least four alpha-numeric characters. Every 8 digit ID is considered a MRN.',
      };
    }
  } else {
    switch (patientIDType) {
    case 'MSK-Patients (or derived from MSK Patients)':
      return {
        pattern: '^[0-9]{8}$',
        columnHeader: 'MRN',
        tooltip: 'The patient\'s MRN.',
        error:
            'MRN is incorrectly formatted, please correct, or speak to a project manager if unsure.',
        type: 'text',
      };
    case 'Non-MSK Patients':
      return {
        pattern: '[A-Za-z0-9\\,_-]{4,}',
        columnHeader: 'Patient ID',
        error:
            'Invalid format. Please use at least four alpha-numeric characters. Dashes and underscores are allowed. Every 8 digit ID is considered a MRN.',
      };
    case 'Cell Lines, not from Patients':
      return { columnHeader: 'Cell Line Name' };
    case 'Both MSK-Patients and Non-MSK Patients':
      return {
        pattern: '[A-Za-z0-9\\,_-]{4,}|^[0-9]{8}$',
        columnHeader: 'Patient ID',
        error:
            'Invalid format. Please use at least four alpha-numeric characters. Dashes and underscores are allowed. Every 8 digit ID is considered a MRN.',
      };
    default:
      return { pattern: 'formatter not found' };
    }
  }
}

export function generateSubmissionGrid(submissions, userRole) {
  return new Promise((resolve, reject) => {
    try {
      let grid = { columnHeaders: [], rows: [], columnFeatures: [] };
      grid.columnHeaders = Object.keys(allColumns.submissionColumns).map(
        (a) => allColumns.submissionColumns[a].name
      );
      grid.columnFeatures = Object.values(allColumns.submissionColumns);

      if (userRole === 'user') {
        grid.columnHeaders = grid.columnHeaders.filter((element) => {
          return element !== 'Unsubmit';
        });
        grid.columnFeatures = grid.columnFeatures.filter((element) => {
          return element.name !== 'Unsubmit';
        });
      }
      let rows = [];
      for (let i = 0; i < submissions.length; i++) {
        let submission = submissions[i];
        let serviceId = submission.formValues.serviceId;

        let isSubmitted = submission.submitted;
        rows[i] = {
          serviceId: serviceId,
          transactionId: submission.transactionId,
          username: submission.username,
          sampleType: submission.formValues.material,
          application: submission.formValues.application,
          numberOfSamples: submission.formValues.numberOfSamples,
          submitted: isSubmitted ? 'yes' : 'no',
          revisions: submission.__v,
          createdAt: parseDate(submission.createdAt),
          submittedAt: submission.submittedAt
            ? parseDate(submission.submittedAt)
            : '',
          // available actions depend on submitted status
          edit: isSubmitted
            ? `<span  submitted=${isSubmitted} service-id=${serviceId} submission-id=${submission.id} class="material-icons grid-action-disabled">edit</span>`
            : `<span submitted=${isSubmitted} service-id=${serviceId} submission-id=${submission.id} class="material-icons grid-action">edit</span>`,
          receipt: isSubmitted
            ? `<span submitted=${isSubmitted} service-id=${serviceId} submission-id=${submission.id} class="material-icons grid-action grid-action">cloud_download</span>`
            : `<span submitted=${isSubmitted} service-id=${serviceId} submission-id=${submission.id} class="material-icons grid-action-disabled">cloud_download</span>`,
          delete: isSubmitted
            ? `<span submitted=${isSubmitted} service-id=${serviceId} submission-id=${submission.id} class="material-icons grid-action-disabled">delete</span>`
            : `<span submitted=${isSubmitted} service-id=${serviceId} submission-id=${submission.id} class="material-icons grid-action">delete</span>`,
        };
        if (userRole !== 'user') {
          rows[i].unsubmit = !isSubmitted
            ? `<span submitted=${isSubmitted} service-id=${serviceId} submission-id=${submission.id} class="material-icons grid-action-disabled">undo</span>`
            : `<span submitted=${isSubmitted} service-id=${serviceId} submission-id=${submission.id} class="material-icons grid-action">undo</span>`;
        }

        if (rows.length === submissions.length) {
          grid.rows = rows;
          resolve(grid);
        }
      }
    } catch (err) {
      reject(err);
    }
  });
}

function parseDate(mongooseDate) {
  let date = new Date(mongooseDate * 1000);
  let minutes = (date.getMinutes() < 10 ? '0' : '') + date.getMinutes();
  let humanReadable = `${
    date.getMonth() + 1
  }/${date.getDate()}/${date.getFullYear()} at ${date.getHours()}:${minutes}`;
  return humanReadable;
}

//  Submits submission to BankedSample. Returns array of created recordIds
export function submit(submission, user, transactionId) {
  return new Promise((resolve, reject) => {
    let serviceId = submission.formValues.serviceId;
    let recipe = submission.formValues.application;
    let sampleType = submission.formValues.material;
    let samples = submission.gridValues;
    let submittedSamples = [];
    // prep banked sample record
    for (let i = 0; i < samples.length; i++) {
      let bankedSample = Object.assign({}, samples[i]);
      bankedSample.serviceId = serviceId;
      bankedSample.recipe = recipe;
      bankedSample.sampleType = sampleType;
      bankedSample.transactionId = transactionId;
      bankedSample.igoUser = user.username;
      bankedSample.investigator = submission.username;
      bankedSample.user = process.env.API_USER;
      bankedSample.concentrationUnits = 'ng/uL';

      if ('wellPosition' in bankedSample) {
        var match = /([A-Za-z]+)(\d+)/.exec(bankedSample.wellPosition);
        if (!match) {
          reject('Invalid Well Position.');
        } else {
          bankedSample.rowPos = match[1];
          bankedSample.colPos = match[2];
          delete bankedSample.wellPosition;
        }
      }
      //  not needed in LIMS, only displayed for users' convenience
      if ('indexSequence' in bankedSample) {
        delete bankedSample.indexSequence;
      }

      // delete empty fields
      Object.keys(bankedSample).map((element) => {
        if (bankedSample[element] === '') {
          delete bankedSample[element];
        }
      });

      services
        .submit(bankedSample)
        .then((response) => {
          logger.log('info', `Submitted ${bankedSample.userId}.`);
          submittedSamples.push(response);
          if (submittedSamples.length === samples.length) {
            resolve(submittedSamples);
          }
        })
        .catch((err) =>
          reject(
            `Submit failed at sample ${bankedSample.userId}, index ${bankedSample.rowIndex}. ${err}`
          )
        );
    }
  });
}

// Generate excel from mongoose submission model.
// Replaces keys with column names and filters noShow columns.
export function generateSubmissionExcel(submission, role) {
  let isUser = role === 'user';
  let sheetData = [];
  let sheetFormData = {};
  // replace form keys with column names and filter out noShow columns
  Object.keys(submission.formValues).map((element) => {
    let colDef = allColumns.formColumns[element] || '';
    let isNoShowCol = isUser && allColumns.noShowColumns.includes(element);
    let isNoShowEmptyCol =
      isUser &&
      allColumns.noShowEmptyColumns.includes(element) &&
      submission.formValues[element] === '';
    if (!isNoShowCol && !isNoShowEmptyCol) {
      let colName = colDef.columnHeader || element;
      sheetFormData[colName] = submission.formValues[element];
    }
  });

  submission.gridValues.map((element, index) => {
    let gridRow = submission.gridValues[index];
    let sheetGridRow = [];
    Object.keys(gridRow).map((element) => {
      let colDef = element;
      let isNoShowCol = isUser && allColumns.noShowColumns.includes(element);
      // find columnHeader for this element in object of objects
      if (!isNoShowCol) {
        for (let key in allColumns.gridColumns) {
          if (allColumns.gridColumns[key].data === element) {
            colDef = allColumns.gridColumns[key].columnHeader;
            break;
          }
        }
        sheetGridRow[colDef] = gridRow[element];
      }
    });
    sheetData.push({ ...sheetFormData, ...sheetGridRow });
  });
  return sheetData;
}

export function generateGridExcel(grid, role) {
  let isUser = role === 'user';
  let sheetData = [];
  let sheetFormData = {};

  grid.map((element, index) => {
    let gridRow = grid[index];
    let sheetGridRow = [];
    Object.keys(gridRow).map((element) => {
      let colDef = element;
      let isNoShowCol = isUser && allColumns.noShowColumns.includes(element);
      // find columnHeader for this element in object of objects
      if (!isNoShowCol) {
        for (let key in allColumns.gridColumns) {
          if (allColumns.gridColumns[key].data === element) {
            colDef = allColumns.gridColumns[key].columnHeader;
            break;
          }
        }
        sheetGridRow[colDef] = gridRow[element];
      }
    });
    sheetData.push({ ...sheetFormData, ...sheetGridRow });
  });
  return sheetData;
}

// PROMOTE

// CLEAN THIS UP

export function generatePromoteGrid(limsColumnOrdering) {
  return new Promise((resolve) => {
    let grid = {
      columnFeatures: [],
      columnHeaders: [],
      rowData: [{}],
    };
    let picklistCols = [];
    // lims returns these columns as ["Integer:String","Integer:String",...]
    limsColumnOrdering.map((element) => {
      let promoteColFeature = {};
      let columnName = element.split(':')[1];
      console.log(columnName);
      console.log(columnName);
      console.log(columnName);
      console.log(columnName);
      console.log(columnName);
      console.log(columnName);
      console.log(columnName);
      // If we recognize the column, attach the feature and add it to the list used for picklist generation
      if (columnName in allColumns.gridColumns) {
        promoteColFeature = Object.assign(
          {},
          allColumns.gridColumns[columnName]
        );
        if (
          'picklistName' in promoteColFeature &&
          promoteColFeature.data !== 'index'
        ) {
          picklistCols.push(columnName);
        }
      } else {
        logger.log('info', `${columnName} not found`);
        promoteColFeature = {
          name: columnName,
          data: camelize(columnName),
          columnHeader: columnName,
        };
      }
      grid.columnFeatures.push(promoteColFeature);
    });
    // console.log(columnNamesOnly)
    cacheAllPicklists(picklistCols).then((picklists) => {
      grid.columnFeatures.map((promoteColFeature) => {
        if (promoteColFeature.picklistName && !promoteColFeature.source) {
          if (promoteColFeature.data === 'index') {
            promoteColFeature.barcodeHash =
              picklists[promoteColFeature.picklistName];
          } else {
            promoteColFeature.source =
              picklists[promoteColFeature.picklistName];
          }
        }
        promoteColFeature.optional = true;
        promoteColFeature.allowEmpty = true;
        promoteColFeature.className = 'optional';
        promoteColFeature.readOnly =
          promoteColFeature.data === 'investigator' ? true : false;
        promoteColFeature.error = promoteColFeature.error
          ? promoteColFeature.error
          : 'Invalid format.';
        grid.rowData[0][promoteColFeature.data] = '';
      });
      grid.columnHeaders = grid.columnFeatures.map(
        (a) =>
          '<span class="' +
          a.className +
          '" title="' +
          a.tooltip +
          '">' +
          a.columnHeader +
          '</span>'
      );
      resolve(grid);
    });
  });
}
function camelize(str) {
  return str
    .replace(/(?:^\w|[A-Z]|\b\w)/g, function (word, index) {
      return index === 0 ? word.toLowerCase() : word.toUpperCase();
    })
    .replace(/\s+/g, '');
}

export function loadBankedSamples(queryType, query) {
  return new Promise((resolve) => {
    services.loadBankedSamples(queryType, query).then((response) => {
      // TODO: Clean out some data like in old rex?
      resolve(response);
    });
  });
}

// PROMOTE END
