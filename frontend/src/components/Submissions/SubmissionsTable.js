import { HotTable } from '@handsontable/react'

import 'handsontable/dist/handsontable.full.css'
import React from 'react'
import { withStyles } from '@material-ui/core'

class SubmissionsTable extends React.Component {
  constructor(props) {
    super(props)
    this.hotTableComponent = React.createRef()
  }

  render() {
    const { classes, handleEdit, handleReceipt, handleDelete, grid } = this.props
    return (
      <div className={classes.container} >
        <HotTable
          licenseKey="non-commercial-and-evaluation"
          id="hot"
          ref={this.hotTableComponent}
          data={grid.rows}
          colHeaders={grid.columnHeaders}
          rowHeaders={true}
          readOnly
          className="htCenter"
          columns={grid.columnFeatures}
          // stretchH="all"
          width="95%"
          filters="true"
          columnSorting="true"
          dropdownMenu={['filter_by_value', 'filter_action_bar']}
          // make actions clickable
          afterOnCellMouseDown={(event, coords, TD) => {
            if (coords.row != -1 && ([10, 11, 12].indexOf(coords.col) > -1)) {

              let actionElement = TD.firstElementChild || undefined
              let submitted = actionElement ? actionElement.getAttribute('submitted') == "true" : undefined
              let id = actionElement ? actionElement.getAttribute('submission-id') : undefined

              if (coords.col === 10 && !submitted) {
                handleEdit(id)
              } else if (coords.col === 11 && submitted) {
                let service_id = actionElement ? actionElement.getAttribute('service-id') : undefined
                handleReceipt(id, service_id)
              } else if (coords.col === 12 && !submitted) {
                handleDelete(id)
              }
            }
          }}
        />
      </div>
    )
  }
}



const styles = theme => ({
  // container: { width: '80vw' }

})
export default withStyles(styles)(SubmissionsTable)
