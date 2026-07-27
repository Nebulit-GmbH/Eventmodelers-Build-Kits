import { DataTableForObservableQuery } from '@cratis/components/DataTables';
import { AllListings } from './AllListings';
import { Column } from 'primereact/column';

export const ListingDataTable = () => {
    return (
        <>
            <DataTableForObservableQuery
                query={AllListings}
                dataKey='eventSourceId'
                emptyMessage='No items registered yet.'>
                <Column field='name' header='Name' />
                <Column field='eventSourceId' header='Id' />
            </DataTableForObservableQuery>
        </>
    );
}