import { Button } from 'primereact/button';
import { RegisterDialog } from './Registration';
import { ListingDataTable } from './Listing';
import { useDialog } from '@cratis/arc.react/dialogs';

export const SomeFeature = () => {
    const [RegistrationDialog, showRegistrationDialog] = useDialog(RegisterDialog);

    return (
        <div className='p-4'>
            <div className='flex justify-between items-center mb-4'>
                <h1 className='text-2xl font-bold'>SomeFeature</h1>
                <Button
                    label='Register'
                    icon='pi pi-plus'
                    onClick={() => showRegistrationDialog()} />
            </div>
            <ListingDataTable />
            <RegistrationDialog />
        </div>
    );
};
