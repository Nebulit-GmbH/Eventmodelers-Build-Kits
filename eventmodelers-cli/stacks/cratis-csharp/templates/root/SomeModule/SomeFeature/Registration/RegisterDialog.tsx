import { CommandDialog } from '@cratis/components/CommandDialog';
import { InputTextField } from '@cratis/components/CommandForm';
import { Register } from './Register';

export const RegisterDialog = () => {
    return (
        <CommandDialog
            command={Register}
            title='Register'
            okLabel='Register'
            cancelLabel='Cancel'>
            <InputTextField<Register>
                value={c => c.name}
                title='Name'
                icon={<i className='pi pi-pencil' />} />
        </CommandDialog>
    );
}